const Trip = require('../models/Trip');
const Load = require('../models/Load');
const User = require('../models/User');
const Rating = require('../models/Rating');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const paymentController = require('./paymentController');
const logger = require('../config/logger');

// ─── DRIVER: Start trip (just marks started, no payout yet) ──────────────────
// PATCH /trips/:id/start
exports.startTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'accepted') return res.status(400).json({ success: false, message: 'Trip cannot be started.' });

    let truckId = req.body.truckId;
    if (!truckId) {
      const Truck = require('../models/Truck');
      const driverTrucks = await Truck.find({ owner: req.user._id, isActive: true });
      if (driverTrucks.length === 1) {
        truckId = driverTrucks[0]._id;
      }
    }

    const updates = { status: 'started', startTime: new Date() };
    if (truckId) {
      updates.truck = truckId;
    }

    await Trip.findByIdAndUpdate(trip._id, updates);

    const transporter = await User.findById(trip.transporter);
    await notificationService.sendNotification(trip.transporter, {
      title: 'Driver En Route 🚛',
      body: 'Your driver has started heading to the pickup location.',
      type: 'trip',
      data: { tripId: trip._id.toString() },
      fcmToken: transporter?.fcmToken,
    });

    res.json({ success: true, message: 'Trip started.' });
  } catch (err) { next(err); }
};

// ─── DRIVER: Upload loading proof ─────────────────────────────────────────────
// PATCH /trips/:id/loading-proof
exports.uploadLoadingProof = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (!['started', 'accepted'].includes(trip.status)) {
      return res.status(400).json({ success: false, message: 'Cannot upload loading proof at this stage.' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'At least one photo is required.' });
    }

    const loadingProof = req.files.map(f => f.path);
    const { loadingNote } = req.body;

    await Trip.findByIdAndUpdate(trip._id, {
      status: 'in_transit',
      loadingProof,
      loadingNote: loadingNote || '',
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'in_transit' });

    // Notify transporter to approve loading
    const transporter = await User.findById(trip.transporter);
    await notificationService.sendNotification(trip.transporter, {
      title: 'Loading Complete — Approval Needed 📦',
      body: 'Driver has uploaded loading proof. Please review and approve to release 90% payment.',
      type: 'payment',
      data: { tripId: trip._id.toString(), action: 'approve_loading' },
      fcmToken: transporter?.fcmToken,
    });

    res.json({ success: true, message: 'Loading proof uploaded. Awaiting transporter approval.' });
  } catch (err) { next(err); }
};

// ─── TRANSPORTER: Approve loading → release 90% ───────────────────────────────
// PATCH /trips/:id/approve-loading
exports.approveLoading = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'in_transit') {
      return res.status(400).json({ success: false, message: 'Loading proof not yet submitted.' });
    }
    if (trip.payoutStage !== 'none') {
      return res.status(400).json({ success: false, message: 'Loading already approved.' });
    }

    await Trip.findByIdAndUpdate(trip._id, { loadingApprovedAt: new Date() });

    // Release 90% payout
    try {
      await paymentController.processLoadingPayout(trip._id);
    } catch (err) {
      logger.error('Loading payout failed:', err.message);
      return res.status(500).json({ success: false, message: 'Payout processing failed. Please try again.' });
    }

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Loading Approved! 💸',
      body: '90% of your payment has been released. Continue to delivery.',
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    res.json({ success: true, message: 'Loading approved. 90% payout initiated.' });
  } catch (err) { next(err); }
};

// ─── DRIVER: Upload delivery proof ────────────────────────────────────────────
// PATCH /trips/:id/complete  (existing endpoint, renamed semantically)
exports.completeTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, driver: req.user._id })
      .populate('transporter');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'in_transit') {
      return res.status(400).json({ success: false, message: 'Trip is not in transit.' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'At least one delivery photo is required.' });
    }

    const deliveryProof = req.files.map(f => f.path);
    const { deliveryNote } = req.body;

    await Trip.findByIdAndUpdate(trip._id, {
      status: 'delivered',
      deliveredTime: new Date(),
      deliveryProof,
      deliveryNote: deliveryNote || '',
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'delivered' });

    // Notify transporter to approve delivery
    await notificationService.sendNotification(trip.transporter._id, {
      title: 'Delivery Done — Approval Needed ✅',
      body: 'Driver has uploaded delivery proof. Please review and approve to release final 10% payment.',
      type: 'payment',
      data: { tripId: trip._id.toString(), action: 'approve_delivery' },
      fcmToken: trip.transporter.fcmToken,
    });

    res.json({ success: true, message: 'Delivery proof uploaded. Awaiting transporter approval.' });
  } catch (err) { next(err); }
};

// ─── TRANSPORTER: Approve delivery → release 10% ─────────────────────────────
// PATCH /trips/:id/approve-delivery
exports.approveDelivery = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, transporter: req.user._id });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    if (trip.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Delivery proof not yet submitted.' });
    }
    if (trip.payoutStage === 'delivery_paid') {
      return res.status(400).json({ success: false, message: 'Delivery already approved.' });
    }

    await Trip.findByIdAndUpdate(trip._id, {
      deliveryApprovedAt: new Date(),
      status: 'completed',
      completedTime: new Date(),
    });
    await Load.findByIdAndUpdate(trip.load, { status: 'completed' });
    await User.findByIdAndUpdate(trip.driver, { $inc: { totalTrips: 1 } });

    // Release 10% payout
    try {
      await paymentController.processDeliveryPayout(trip._id);
    } catch (err) {
      logger.error('Delivery payout failed:', err.message);
      // Fallback: credit to wallet
      if (trip.payoutStage !== 'delivery_paid') {
        const deliveryAmount = Math.round(trip.driverEarnings * 0.1);
        await walletService.credit(
          trip.driver,
          deliveryAmount,
          'Delivery payout (10%) - wallet fallback',
          'trip_earning',
          trip._id,
        );
      }
    }

    const driver = await User.findById(trip.driver);
    await notificationService.sendNotification(trip.driver, {
      title: 'Trip Complete! 🎉',
      body: 'Final 10% payment has been released. Great job!',
      type: 'payment',
      data: { tripId: trip._id.toString() },
      fcmToken: driver?.fcmToken,
    });

    res.json({ success: true, message: 'Delivery approved. Final payout initiated.' });
  } catch (err) { next(err); }
};

// ─── PATCH /trips/:id/location ────────────────────────────────────────────────
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    await Trip.findByIdAndUpdate(req.params.id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    await User.findByIdAndUpdate(req.user._id, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] },
    });
    const io = req.app.get('io');
    if (io) io.to(`trip_${req.params.id}`).emit('location_update', { lat, lng, tripId: req.params.id });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─── GET /shipments/active (transporter) ─────────────────────────────────────
exports.getActiveShipments = async (req, res, next) => {
  try {
    const trips = await Trip.find({
      transporter: req.user._id,
      status: { $in: ['accepted', 'started', 'in_transit', 'delivered'] },
    })
      .populate('load')
      .populate('driver', 'name phone rating profileImage')
      .populate('truck', 'registrationNumber type')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: trips });
  } catch (err) { next(err); }
};

// ─── GET /shipments/history (transporter) ────────────────────────────────────
exports.getShipmentHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const [shipments, total] = await Promise.all([
      Trip.find({ transporter: req.user._id, status: { $in: ['completed', 'cancelled'] } })
        .populate('load').populate('driver', 'name phone rating')
        .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Trip.countDocuments({ transporter: req.user._id, status: { $in: ['completed', 'cancelled'] } }),
    ]);
    res.json({ success: true, data: { shipments, total, page: Number(page) } });
  } catch (err) { next(err); }
};

// ─── GET /shipments/:id ───────────────────────────────────────────────────────
exports.getShipmentById = async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('load')
      .populate('driver', 'name phone rating profileImage')
      .populate('truck', 'registrationNumber type capacity model');
    if (!trip) return res.status(404).json({ success: false, message: 'Shipment not found.' });
    res.json({ success: true, data: trip });
  } catch (err) { next(err); }
};

// ─── POST /trips/:id/rate ─────────────────────────────────────────────────────
exports.rateTrip = async (req, res, next) => {
  try {
    const { score, comment, tags } = req.body;
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found.' });
    const toUser = req.user.role === 'driver' ? trip.transporter : trip.driver;
    const existing = await Rating.findOne({ trip: trip._id, fromUser: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already rated.' });
    await Rating.create({ trip: trip._id, fromUser: req.user._id, toUser, score, comment, tags });
    const ratings = await Rating.find({ toUser });
    const avg = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
    await User.findByIdAndUpdate(toUser, { rating: Math.round(avg * 10) / 10, totalRatings: ratings.length });
    res.json({ success: true, message: 'Rating submitted.' });
  } catch (err) { next(err); }
};

exports.getLoadingMemo = async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const Trip = require('../models/Trip');
    const User = require('../models/User');
    const Settings = require('../models/Settings');
    const Truck = require('../models/Truck');

    const trip = await Trip.findById(req.params.id)
      .populate('load')
      .populate('driver')
      .populate('truck');

    if (!trip) return res.status(404).send('<h2>Trip not found.</h2>');

    let settings = await Settings.findOne({ key: 'company_memo_settings' });
    if (!settings) {
      settings = {
        value: {
          companyName: 'TruxHire Solutions Pvt Ltd',
          address: 'Main Rd, Opp outer ring road, Bengaluru, Karnataka- 560103',
          gstNumber: '29AAACZ8319C1Z7',
          bankName: 'Kotak Mahindra Bank',
          accountNumber: '7948035729',
          ifscCode: 'KKBK0008066',
          branchName: '22, Ground Floor, M.G.Road, Bengaluru, Karnataka 560001',
          chequeImage: '',
          panImage: '',
          panNumber: 'AAACZ8319C',
        }
      };
    }

    const { load, driver, truck } = trip;
    const transporter = await User.findById(trip.transporter);

    const offeredPrice = load?.offeredPrice || 0;
    const advance = Math.round(offeredPrice * 0.9);
    const balance = offeredPrice - advance;

    // Base64 helper
    const toBase64 = (p) => {
      if (!p) return '';
      try {
        const absPath = path.isAbsolute(p) ? p : path.resolve(__dirname, '../../', p);
        if (fs.existsSync(absPath)) {
          const bitmap = fs.readFileSync(absPath);
          const ext = path.extname(absPath).replace('.', '').toLowerCase();
          return `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${bitmap.toString('base64')}`;
        }
      } catch (err) {}
      return '';
    };

    const logoBase64 = toBase64('/Volumes/arpit1tb/truxhire/Backend/src/public/Trux Hire Logo Red Black.png');
    const driverPanBase64 = driver?.panImage ? toBase64(driver.panImage) : '';
    const truckRcBase64 = truck?.rcImage ? toBase64(truck.rcImage) : '';
    const companyChequeBase64 = settings.value.chequeImage ? toBase64(settings.value.chequeImage) : '';
    const companyPanBase64 = settings.value.panImage ? toBase64(settings.value.panImage) : '';

    // Helper: build the memo body HTML (reused for both browser view and PDF)
    const buildMemoBody = () => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Loading Memo - ${trip._id}</title>
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; line-height: 1.4; padding: 30px; margin: 0; background-color: #FAFAFA; }
        .memo-container { max-width: 800px; margin: 0 auto; background: #FFF; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header-table { width: 100%; margin-bottom: 25px; border-collapse: collapse; }
        .header-text { width: 65%; font-size: 13px; color: #555; }
        .logo-cell { width: 35%; text-align: right; }
        .logo-cell img { max-width: 180px; max-height: 80px; object-fit: contain; }
        .memo-title { text-align: center; font-size: 22px; font-weight: bold; margin: 25px 0 10px; border-bottom: 2px solid #000; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 1.2px; }
        .meta-table { width: 100%; margin-bottom: 25px; font-size: 14px; font-weight: bold; border-collapse: collapse; }
        .details-table { width: 100%; margin-bottom: 30px; border-collapse: collapse; }
        .details-table td { padding: 8px 0; font-size: 13px; }
        .details-table .label { width: 35%; color: #666; font-weight: 500; text-transform: uppercase; }
        .details-table .val { width: 65%; font-weight: 700; color: #111; }
        .section-title { font-size: 16px; font-weight: bold; margin: 30px 0 15px; border-bottom: 1px dashed #CCC; padding-bottom: 5px; color: #111; }
        .img-block { text-align: center; margin: 15px 0; }
        .img-block img { max-width: 380px; border-radius: 6px; border: 1px solid #DDD; }
        .img-block h4 { font-size: 13px; color: #444; margin-bottom: 8px; }
        .grid-table { width: 100%; border-collapse: collapse; }
        .grid-table td { width: 50%; vertical-align: top; }
        .bank-details { margin-bottom: 20px; }
        .bank-details p { margin: 5px 0; font-size: 13px; }
        .bank-details strong { width: 140px; display: inline-block; color: #555; }

        /* PDF Actions Styles */
        .pdf-action-bar {
          max-width: 800px;
          margin: 0 auto 20px auto;
          display: flex;
          justify-content: flex-end;
        }
        .pdf-btn {
          background-color: #E53935;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 14px;
          font-weight: bold;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-transform: uppercase;
          box-shadow: 0 4px 10px rgba(229,57,53,0.3);
          transition: all 0.2s ease-in-out;
        }
        .pdf-btn:hover {
          background-color: #D32F2F;
          box-shadow: 0 6px 14px rgba(229,57,53,0.4);
        }

        @media print {
          body { background-color: #FFF; padding: 0; margin: 0; }
          .memo-container { box-shadow: none; padding: 0; }
          .pdf-action-bar { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="memo-container">
        <table class="header-table">
          <tr>
            <td class="header-text">
              <strong style="font-size: 16px; color: #000;">${settings.value.companyName}</strong><br>
              ${settings.value.address}<br>
              GST No. - ${settings.value.gstNumber}
            </td>
            <td class="logo-cell">
              ${logoBase64 ? `<img src="${logoBase64}" alt="Logo">` : '<h2>TRUX HIRE</h2>'}
            </td>
          </tr>
        </table>

        <div class="memo-title">Loading Memo</div>

        <table class="meta-table">
          <tr>
            <td>Trip No: ${trip._id.toString().toUpperCase()}</td>
            <td style="text-align: right;">Date: ${new Date(trip.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          </tr>
        </table>

        <table class="details-table">
          <tr>
            <td class="label">Transporter</td>
            <td class="val">: ${transporter?.companyName || transporter?.name || '—'}</td>
          </tr>
          <tr>
            <td class="label">Truck No</td>
            <td class="val">: ${truck?.registrationNumber || '—'}</td>
          </tr>
          <tr>
            <td class="label">Truck Type</td>
            <td class="val">: ${truck?.type ? truck.type.replace(/_/g, ' ').toUpperCase() : '—'}</td>
          </tr>
          <tr>
            <td class="label">Route</td>
            <td class="val">: ${load?.pickupLocation?.city} to ${load?.dropLocation?.city}</td>
          </tr>
          <tr>
            <td class="label">Loading Date</td>
            <td class="val">: ${new Date(trip.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td class="label">Total Freight (Rs)</td>
            <td class="val">: ₹${offeredPrice.toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td class="label">Advance (Rs)</td>
            <td class="val">: ₹${advance.toLocaleString('en-IN')} (90%)</td>
          </tr>
          <tr>
            <td class="label">Balance (Rs)</td>
            <td class="val">: ₹${balance.toLocaleString('en-IN')} (10%)</td>
          </tr>
        </table>

        <div class="section-title">Truck Supplier / Driver Info</div>
        <table class="details-table" style="margin-bottom: 15px;">
          <tr>
            <td class="label">Truck Owner</td>
            <td class="val">: ${driver?.name || '—'}</td>
          </tr>
          <tr>
            <td class="label">PAN No</td>
            <td class="val">: ${driver?.panNumber || '—'}</td>
          </tr>
        </table>

        ${driverPanBase64 ? `
        <div class="img-block">
          <h4>Truck Owner PAN Card</h4>
          <img src="${driverPanBase64}" alt="PAN Image">
        </div>
        ` : ''}

        ${truckRcBase64 ? `
        <div class="section-title">Truck Owner RC</div>
        <div class="img-block">
          <img src="${truckRcBase64}" alt="RC Image">
        </div>
        ` : ''}

        <div class="section-title">Company Account Details</div>
        <div class="bank-details">
          <p><strong>Beneficiary Name</strong>: ${settings.value.companyName}</p>
          <p><strong>Bank Name</strong>: ${settings.value.bankName}</p>
          <p><strong>Account No</strong>: ${settings.value.accountNumber}</p>
          <p><strong>IFSC Code</strong>: ${settings.value.ifscCode}</p>
          <p><strong>Branch Name</strong>: ${settings.value.branchName}</p>
        </div>

        ${companyChequeBase64 ? `
        <div class="img-block">
          <h4>Admin Cancelled Cheque</h4>
          <img src="${companyChequeBase64}" alt="Cheque Image">
        </div>
        ` : ''}

        ${companyPanBase64 ? `
        <div class="img-block">
          <h4>Company PAN Card</h4>
          <img src="${companyPanBase64}" alt="PAN Image">
        </div>
        ` : ''}
      </div>
    </body>
    </html>
    `;

    // If PDF format requested, render with puppeteer on the server
    if (req.query.format === 'pdf') {
      const puppeteer = require('puppeteer');
      const tempPath = path.join(__dirname, `../../uploads/memo-${trip._id}.pdf`);
      let browser;
      try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        // Use the same HTML but without the download bar
        const pdfHtml = buildMemoBody();
        await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
        await page.pdf({ path: tempPath, format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
        await browser.close();
        return res.download(tempPath, `Loading-Memo-${trip._id}.pdf`, () => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        });
      } catch (pdfErr) {
        if (browser) try { await browser.close(); } catch (_) {}
        console.error('PDF generation error:', pdfErr);
        return res.status(500).send('<h2>PDF generation failed. Please try again.</h2>');
      }
    }

    // Browser view: inject a download bar into the memo HTML
    const memoHtml = buildMemoBody();
    const downloadBar = `
      <div style="max-width:800px; margin:0 auto 20px auto; display:flex; justify-content:flex-end;">
        <a href="?format=pdf" style="background-color:#E53935; color:white; text-decoration:none; padding:12px 24px; font-size:14px; font-weight:bold; border-radius:6px; display:inline-flex; align-items:center; gap:8px; text-transform:uppercase; box-shadow:0 4px 10px rgba(229,57,53,0.3);">
          <svg style="width:18px; height:18px; fill:currentColor;" viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zm7-18L5.33 9h3.17v4h5V9h3.17L12 2z"/></svg>
          Download PDF
        </a>
      </div>`;
    const finalHtml = memoHtml.replace('<body>', '<body>' + downloadBar);

    res.send(finalHtml);
  } catch (err) { next(err); }
};
