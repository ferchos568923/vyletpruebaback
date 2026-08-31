import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import * as qrController from '../controllers/qr.controller.js';
const router = Router();
// ---- CUPONES ----
router.post('/cupones/:id/generar-qr', authenticate, qrController.generarQR);
router.post('/cupones/verificar-qr', authenticate, qrController.verificarQR);
router.post('/cupones/confirmar-canje', authenticate, qrController.confirmarCanje);
// ---- RESERVAS (mesa, habitación, visita) ----
router.post('/reservas/:id/generar-qr', authenticate, qrController.generarQRReservaCtrl);
router.post('/reservas/verificar-qr', authenticate, qrController.verificarQRReservaCtrl);
router.post('/reservas/confirmar-llegada', authenticate, qrController.confirmarLlegada);
export default router;
