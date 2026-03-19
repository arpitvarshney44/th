const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    tags: [{ type: String }], // e.g. ['on_time', 'professional', 'good_communication']
  },
  { timestamps: true },
);

ratingSchema.index({ trip: 1, fromUser: 1 }, { unique: true });
ratingSchema.index({ toUser: 1 });

module.exports = mongoose.model('Rating', ratingSchema);
