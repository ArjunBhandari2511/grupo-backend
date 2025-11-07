const pick = (obj, keys) => {
  if (!obj) return {};
  return keys.reduce((acc, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
};

const getAttachmentDescriptor = (attachment = {}) => {
  const normalized = pick(attachment, [
    'fileType',
    'file_type',
    'mimeType',
    'mime_type',
    'originalName',
    'original_name'
  ]);

  const fileTypeRaw = normalized.fileType || normalized.file_type || '';
  const mimeType = normalized.mimeType || normalized.mime_type || '';
  const originalName = normalized.originalName || normalized.original_name || '';

  const type = (fileTypeRaw || mimeType.split('/')[0]).toLowerCase();

  switch (type) {
    case 'image':
      return { label: 'Image', originalName };
    case 'video':
      return { label: 'Video', originalName };
    case 'audio':
      return { label: 'Audio', originalName };
    case 'document':
      return { label: 'Document', originalName };
    case 'application':
      return { label: 'File', originalName };
    default:
      return { label: type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Attachment', originalName };
  }
};

const buildAttachmentSummary = (attachments) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';

  const { label, originalName } = getAttachmentDescriptor(attachments[0]);
  const displayName = originalName || label;

  let summary = `[${label}] ${displayName}`.trim();

  if (attachments.length > 1) {
    summary = `${summary} (+${attachments.length - 1} more)`;
  }

  return summary;
};

const buildMessageSummary = (body, attachments) => {
  const bodyText = typeof body === 'string' ? body.trim() : '';
  if (bodyText) {
    return bodyText.slice(0, 2000);
  }

  const attachmentSummary = buildAttachmentSummary(attachments);
  if (attachmentSummary) {
    return attachmentSummary.slice(0, 2000);
  }

  return '';
};

module.exports = {
  buildMessageSummary
};

