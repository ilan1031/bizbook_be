// Free text that is shown back to other users (comments, notes) is stored as
// plain text: HTML tags are removed so nothing stored can run as markup even
// if a screen renders it as HTML. Text such as "a < b" or "5 > 3" is kept.
const TAG = /<\/?[a-zA-Z!?][^>]*>/g;

const plainText = (value, maxLength = 2000) => {
  if (value === undefined || value === null) return "";
  let s = String(value);
  // Remove tags until nothing changes ("<scr<script>ipt>").
  for (let i = 0; i < 5; i++) {
    const next = s.replace(TAG, "");
    if (next === s) break;
    s = next;
  }
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
};

module.exports = { plainText };
