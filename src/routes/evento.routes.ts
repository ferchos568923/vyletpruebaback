import { Router } from 'express';
import * as evento from '../controllers/evento.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';

const router = Router();

// Público
router.get('/eventos', evento.listPublic);
router.get('/eventos/banner', evento.listBanner);
router.get('/eventos/:id', evento.getById);

// Admin (configuraciones)
router.get('/admin/eventos', authenticate, requirePermiso('configuraciones:ver'), evento.adminList);
router.post('/admin/eventos', authenticate, requirePermiso('configuraciones:editar'), evento.adminCreate);
router.patch('/admin/eventos/:id', authenticate, requirePermiso('configuraciones:editar'), evento.adminUpdate);
router.delete('/admin/eventos/:id', authenticate, requirePermiso('configuraciones:editar'), evento.adminRemove);

export default router;