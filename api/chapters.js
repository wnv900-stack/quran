const { BASE, relay } = require('./_shared');
module.exports = async (req, res) => relay(`${BASE}/surah`, res,
  p => p?.code === 200 && Array.isArray(p.data) && p.data.length === 114);
