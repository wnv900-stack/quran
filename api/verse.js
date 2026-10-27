const { BASE, error, relay } = require('./_shared');
module.exports = async (req, res) => {
  const surah = Number(req.query.surah), ayah = Number(req.query.ayah || 1);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1 || ayah > 286) return error(res,400,'رقم الآية غير صحيح.');
  return relay(`${BASE}/ayah/${surah}:${ayah}/quran-uthmani`,res,
    p => p?.code === 200 && p.data?.surah?.number === surah && p.data?.numberInSurah === ayah && Number.isInteger(p.data?.page));
};
