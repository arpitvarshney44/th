require('dotenv').config();
const mongoose = require('mongoose');
const Settings = require('./src/models/Settings');

const seedSettings = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const socialLinks = {
      facebook: 'https://facebook.com/truxhire',
      instagram: 'https://instagram.com/truxhire',
      twitter: 'https://twitter.com/truxhire',
      linkedin: 'https://linkedin.com/company/truxhire',
      youtube: 'https://youtube.com/@truxhire'
    };

    const platformInfo = {
      mission: 'TruxHire is building the future of logistics in India. Our mission is to empower every truck driver and transporter with the best-in-class technology, ensuring fair earnings, transparency, and seamless cargo movement across the nation.',
      footer: '© 2026 TruxHire India Pvt Ltd. Made with ❤️ in India'
    };

    const appLinks = {
      driver_play_store: 'https://play.google.com/store/apps/details?id=com.truxhire.driver',
      driver_app_store: 'https://apps.apple.com/app/truxhire-driver/id12345',
      transporter_play_store: 'https://play.google.com/store/apps/details?id=com.truxhire.transporter',
      transporter_app_store: 'https://apps.apple.com/app/truxhire-transporter/id67890'
    };

    const helpCenterDriver = {
      contact: {
        whatsapp: '+919876543210',
        phone: '+919876543210',
        email: 'driver-support@truxhire.in'
      },
      faqs: [
        { question: 'How do I accept a load?', answer: 'Go to the "Find Loads" tab, browse available loads, and tap on "Accept Load" on the load details screen.' },
        { question: 'When will I receive my payment?', answer: 'Payments are processed once the trip is marked as "Delivered" and verified.' }
      ]
    };

    const helpCenterTransporter = {
      contact: {
        whatsapp: '+919876543211',
        phone: '+919876543211',
        email: 'transporter-support@truxhire.in'
      },
      faqs: [
        { question: 'How do I post a load?', answer: 'Tap the "Post Load" button on the dashboard, fill in the details, and set your price.' },
        { question: 'How do I verify a delivery?', answer: 'Once the driver uploads the delivery proof, you can review it and mark the trip as completed.' }
      ]
    };

    await Promise.all([
      Settings.findOneAndUpdate(
        { key: 'social_links' },
        { value: socialLinks, description: 'Social media links for the platform' },
        { upsert: true, new: true }
      ),
      Settings.findOneAndUpdate(
        { key: 'platform_info' },
        { value: platformInfo, description: 'Platform mission and footer text' },
        { upsert: true, new: true }
      ),
      Settings.findOneAndUpdate(
        { key: 'app_links' },
        { value: appLinks, description: 'Play Store and App Store links' },
        { upsert: true, new: true }
      ),
      Settings.findOneAndUpdate(
        { key: 'help_center_driver' },
        { value: helpCenterDriver, description: 'Driver Help center FAQs and contact support' },
        { upsert: true, new: true }
      ),
      Settings.findOneAndUpdate(
        { key: 'help_center_transporter' },
        { value: helpCenterTransporter, description: 'Transporter Help center FAQs and contact support' },
        { upsert: true, new: true }
      )
    ]);

    console.log('Social links seeded successfully');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedSettings();
