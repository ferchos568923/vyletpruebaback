import { Router } from 'express';
import * as habitacion from '../controllers/habitacion.controller.js';
import { authenticate } from '../middlewares/auth.js';
const router = Router();
// Públicas
router.get('/sucursales/:id/habitaciones', habitacion.listarHabitaciones);
router.get('/sucursales/:id/habitaciones/disponibilidad', habitacion.disponibilidadSucursal);
// Protegidas (la autorización se valida dentro del controlador por empresa)
router.post('/sucursales/:id/habitaciones', authenticate, habitacion.crearHabitacion);
router.patch('/habitaciones/:id', authenticate, habitacion.actualizarHabitacion);
router.delete('/habitaciones/:id', authenticate, habitacion.eliminarHabitacion);
// Reservas de habitación
router.post('/habitaciones/:id/reservas', authenticate, habitacion.crearReservaHabitacion);
router.post('/sucursales/:id/reservas-habitacion/multi', authenticate, habitacion.crearReservaHabitacionMulti);
router.post('/sucursales/:id/reservas-habitacion', authenticate, habitacion.crearReservaManual);
router.get('/sucursales/:id/reservas-habitacion', authenticate, habitacion.listarReservasSucursal);
router.patch('/reservas-habitacion/:id', authenticate, habitacion.cambiarEstadoReservaHabitacion);
export default router;
