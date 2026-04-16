const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure sub-folders exist
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organise by user id when available, else general
    const userId = req.user?._id?.toString() || 'general';
    const dest = path.join('uploads', userId);
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // fieldname-timestamp.ext  → e.g. license-1718900000000.jpg
    const unique = `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  cb(new Error('Only images (JPEG, PNG) and PDFs are allowed.'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

// Helper: convert disk path → URL path that the app can access
// e.g. "uploads/abc123/license-171890.jpg" → "uploads/abc123/license-171890.jpg"
// Note: NO leading slash — getFileURL in the app prepends the server root with its own slash
const fileUrl = (filePath) => {
  if (!filePath) return null;
  // Normalise backslashes (Windows), strip any leading slash
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
};

module.exports = upload;
module.exports.fileUrl = fileUrl;
