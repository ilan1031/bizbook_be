const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EmailLogSchema = new Schema({
  email_log_id: {
    type: String,
    required: true,
    unique: true
  },
  from_email: {
    type: String,
    required: true
  },
  to_email: {
    type: String, 
    required: true
  },
  cc_emails: {
    type: String,
    default: ''
  },
  bcc_emails: {
    type: String,
    default: ''
  },
  subject: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  attachment_names: [String],
  order_id: {
    type: String,
    default: null
  },
  order_type: {
    type: String,
    enum: ['salesorder', 'purchaseorder', 'invoice', 'other'],
    default: 'other'
  },
  organization_id: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },
  message_id: {
    type: String
  },
  error_message: {
    type: String
  },
  created_by: {
    type: Schema.Types.Mixed
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { 
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Create a compound index for faster querying
EmailLogSchema.index({ organization_id: 1, created_at: -1 });

const EmailLog = mongoose.model('EmailLog', EmailLogSchema);
module.exports = EmailLog;