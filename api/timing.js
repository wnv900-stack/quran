const { error, relay } = require('./_shared');
module.exports = async (req, res) => {
  const surah = Number(req.query.surah);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return error(res,400,'رقم السورة غير صحيح.');
  return relay(`https://api.kalamalah.com/api/timing/maher-al-muaiqly/murattal/${String(surah).padStart(3, '0')}`, res,
    p => Array.isArray(p?.recitation_timings) && p.recitation_timings.some(v => typeof v.verse === 'string') &&
      typeof p.metadata?.recitation_info?.audio_url === 'string');
};
