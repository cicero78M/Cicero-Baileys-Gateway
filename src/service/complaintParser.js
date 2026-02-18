function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function cleanHeaderDecorators(line) {
  return String(line || '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/^[\s\-•●*]+/, '')
    .trim();
}

function normalizeKey(value) {
  return cleanHeaderDecorators(value)
    .toLowerCase()
    .replace(/[：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isComplaintHeader(line) {
  return /^pesan\s+komplain\b/i.test(cleanHeaderDecorators(line));
}

function isIssueHeader(line) {
  const normalized = normalizeKey(line);
  if (!normalized) return false;
  if (/^kendala\b/.test(normalized)) return true;
  if (/(^|\s)(rincian|detail|uraian|keterangan|deskripsi)\s+kendala\b/.test(normalized)) {
    return true;
  }
  return /\bkendala\s+yang\s+(dihadapi|dialami)\b/.test(normalized);
}

function parseFieldLine(line) {
  if (!line || (!line.includes(':') && !line.includes('：'))) return null;
  const [rawKey, ...rest] = line.split(/[:：]/);
  const value = rest.join(':').trim();
  const key = normalizeKey(rawKey);

  if (!key) return null;
  if (/^nrp\b|^nip\b|^nrp\s*\/\s*nip\b/.test(key)) return { field: 'nrp', value };
  if (/^nama\b/.test(key)) return { field: 'nama', value };
  if (/^(polres|satker)\b/.test(key)) return { field: 'polres', value };
  if (/^(username\s+ig|username\s+instagram|instagram)\b/.test(key)) {
    return { field: 'igUsername', value };
  }
  if (/^(username\s+tiktok|tiktok)\b/.test(key)) return { field: 'tiktokUsername', value };
  return null;
}

function stripIssuePrefix(line) {
  return String(line || '')
    .replace(/^\s*[•●\-*]+\s*/, '')
    .replace(/^\s*\d+\s*[.)-]\s*/, '')
    .trim();
}

function normalizeUsername(value) {
  if (!value) return '';
  return String(value).trim();
}

export function parseComplaintMessage(text) {
  const normalizedText = normalizeText(text);
  const lines = normalizedText.split(/\n/);

  const complaintHeaderIndex = lines.findIndex((line) => isComplaintHeader(line));
  const isComplaint = complaintHeaderIndex >= 0;

  const reporter = {
    nrp: '',
    nama: '',
    polres: '',
    igUsername: '',
    tiktokUsername: '',
  };
  const issues = [];

  if (!isComplaint) {
    return {
      isComplaint: false,
      reporter,
      issues,
      raw: { normalizedText },
    };
  }

  let inIssueSection = false;

  for (let i = complaintHeaderIndex + 1; i < lines.length; i += 1) {
    const rawLine = lines[i] || '';
    const line = rawLine.trim();
    if (!line) continue;

    const fieldInfo = parseFieldLine(line);
    if (fieldInfo) {
      reporter[fieldInfo.field] = fieldInfo.field.includes('Username')
        ? normalizeUsername(fieldInfo.value)
        : fieldInfo.value;
      continue;
    }

    if (isIssueHeader(line)) {
      inIssueSection = true;
      const inlineIssue = line.split(/[:：]/).slice(1).join(':').trim();
      if (inlineIssue) {
        const parsedInline = stripIssuePrefix(inlineIssue);
        if (parsedInline) issues.push(parsedInline);
      }
      continue;
    }

    if (!inIssueSection) {
      continue;
    }

    const issue = stripIssuePrefix(line);
    if (!issue) continue;

    if (parseFieldLine(issue)) {
      continue;
    }

    issues.push(issue);
  }

  reporter.igUsername = normalizeUsername(reporter.igUsername);
  reporter.tiktokUsername = normalizeUsername(reporter.tiktokUsername);

  return {
    isComplaint: true,
    reporter,
    issues,
    raw: { normalizedText },
  };
}
