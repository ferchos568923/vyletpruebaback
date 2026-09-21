import { Router } from 'express';
import * as usuarioController from '../controllers/usuario.controller.js';
import * as habitacionController from '../controllers/habitacion.controller.js';
import * as compartidaController from '../controllers/reserva-compartida.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';
const router = Router();
// Mis reservas de habitación (ANTES de /:id para evitar conflicto)
router.get('/mis-reservas-habitacion', authenticate, habitacionController.misReservasHabitacion);
// Búsqueda de usuarios para compartir (ANTES de /:id para evitar conflicto)
router.get('/buscar', authenticate, compartidaController.buscarUsuarios);
router.get('/', authenticate, requirePermiso('usuarios:listar'), usuarioController.list);
router.post('/', authenticate, requirePermiso('usuarios:crear'), usuarioController.create);
router.get('/:id', authenticate, requirePermiso('usuarios:ver'), usuarioController.getById);
router.patch('/:id', authenticate, requirePermiso('usuarios:editar'), usuarioController.update);
router.patch('/:id/bloquear', authenticate, requirePermiso('usuarios:bloquear'), usuarioController.toggleActivo);
router.patch('/:id/roles', authenticate, requirePermiso('roles:asignar'), usuarioController.assignRoles);
router.post('/:id/hacer-dueno', authenticate, requirePermiso('usuarios:editar'), usuarioController.hacerDueno);
router.delete('/:id', authenticate, requirePermiso('usuarios:eliminar'), usuarioController.remove);
export default router;
