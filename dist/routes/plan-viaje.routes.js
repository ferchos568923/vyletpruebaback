import { Router } from 'express';
import * as planViajeController from '../controllers/plan-viaje.controller.js';
import { authenticate } from '../middlewares/auth.js';
const router = Router();
// Públicos (ver plan con código)
router.get('/planes-viaje/tipos', planViajeController.listarTipos);
router.get('/planes-viaje/publicos', planViajeController.listarPublicos);
router.get('/planes-viaje/sucursales', planViajeController.listarSucursalesDisponibles);
router.get('/planes-viaje/eventos', planViajeController.listarEventosDisponibles);
router.get('/planes-viaje/amigos/buscar', authenticate, planViajeController.buscarAmigos);
router.get('/planes-viaje/publico/:codigo', planViajeController.obtenerPublico);
router.post('/planes-viaje/publico/:codigo/copiar', authenticate, planViajeController.copiarPublico);
// Mis planes (autenticado)
router.post('/planes-viaje', authenticate, planViajeController.crear);
router.get('/planes-viaje', authenticate, planViajeController.listarMios);
router.get('/planes-viaje/:id', authenticate, planViajeController.obtener);
router.patch('/planes-viaje/:id', authenticate, planViajeController.actualizar);
router.delete('/planes-viaje/:id', authenticate, planViajeController.eliminar);
router.post('/planes-viaje/:id/sucursales', authenticate, planViajeController.agregarSucursal);
router.delete('/planes-viaje/:id/sucursales/:sucursalId', authenticate, planViajeController.quitarSucursal);
router.patch('/planes-viaje/:id/publico', authenticate, planViajeController.cambiarPublico);
router.post('/planes-viaje/:id/amigos', authenticate, planViajeController.agregarAmigo);
router.delete('/planes-viaje/:id/amigos/:usuarioId', authenticate, planViajeController.quitarAmigo);
router.post('/planes-viaje/:id/eventos', authenticate, planViajeController.agregarEvento);
router.delete('/planes-viaje/:id/eventos/:eventoId', authenticate, planViajeController.quitarEvento);
export default router;
