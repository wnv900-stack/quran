const { BASE, error, relay } = require('./_shared');
module.exports = async (req, res) => {
  const page = Number(req.query.page);
  if (!Number.isInteger(page) || page < 1 || page > 604) return error(res, 400, 'رقم الصفحة يجب أن يكون بين 1 و604.');
  return relay(`${BASE}/page/${page}/quran-uthmani`, res,
    p => p?.code === 200 && p.data?.number === page && Array.isArray(p.data?.ayahs) && p.data.ayahs.length > 0 &&
      p.data.ayahs.every(a => a.page === page && typeof a.text === 'string' && a.text.length > 0 &&
        Number.isInteger(a.surah?.number) && a.surah.number >= 1 && a.surah.number <= 114 &&
        Number.isInteger(a.numberInSurah)));
};
