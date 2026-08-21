import { v2 as cloudinary } from 'cloudinary';
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// POST /api/upload  (autenticado) — recibe { data: dataURI, carpeta?: string }
export const upload = async (req, res) => {
    try {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) {
            return res.status(500).json({ error: 'Cloudinary no está configurado. Agrega las credenciales en .env' });
        }
        const { data, carpeta } = req.body ?? {};
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'El campo data (imagen en base64) es requerido' });
        }
        if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) {
            return res.status(400).json({ error: 'La imagen supera los 10 MB' });
        }
        const folder = ['empresas', 'eventos', 'habitaciones', 'productos', 'publicidad', 'sucursales'].includes(carpeta)
            ? `vylet/${carpeta}`
            : 'vylet/general';
        const resultado = await cloudinary.uploader.upload(data, {
            folder,
            resource_type: 'auto',
            transformation: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
        });
        res.json({ url: resultado.secure_url, public_id: resultado.public_id });
    }
    catch (error) {
        console.error('Error subiendo imagen:', error);
        res.status(500).json({ error: error?.message ?? 'Error al subir la imagen' });
    }
};
