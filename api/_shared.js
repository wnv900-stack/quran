const BASE = 'https://api.alquran.cloud/v1';
function error(res, status, message) { return res.status(status).json({ error: message }); }
async function relay(url, res, validator) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);
    let response;
    try { response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } }); }
    finally { clearTimeout(id); }
    if (!response.ok) return error(res, 502, 'تعذر الوصول إلى مصدر البيانات المعتمد.');
    const payload = await response.json();
    if (!validator(payload)) return error(res, 502, 'وصلت بيانات غير مكتملة من المصدر.');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(payload);
  } catch { return error(res, 503, 'تعذر الاتصال بالمصدر حالياً.'); }
}
module.exports = { BASE, error, relay };
