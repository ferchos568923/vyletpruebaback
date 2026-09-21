import { Router } from 'express';
import * as compartida from '../controllers/reserva-compartida.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.post('/reservas/:id/compartir', authenticate, compartida.compartirReserva);
router.get('/mis-reservas-compartidas', authenticate, compartida.misReservasCompartidas);
router.get('/mis-reservas-compartidas/enviadas', authenticate, compartida.misReservasEnviadas);
router.patch('/reservas-compartidas/:id', authenticate, compartida.responderCompartida);

export default router;
