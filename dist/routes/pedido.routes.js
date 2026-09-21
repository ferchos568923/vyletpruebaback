import { Router } from 'express';
import * as pedido from '../controllers/pedido.controller.js';
import { authenticate, authenticateOpcional, requireSucursalAcceso } from '../middlewares/auth.js';
const router = Router();
// Gestión (dueño/staff/empleado de la sucursal)
router.get('/sucursales/:id/pedidos', authenticate, requireSucursalAcceso('sucursales:editar'), pedido.listarPedidos);
router.patch('/pedidos/:id/estado', authenticate, pedido.cambiarEstadoPedido);
router.patch('/pedidos/detalle/:detalleId/estado', authenticate, pedido.cambiarEstadoDetalle);
// Cliente (público; usuario opcional si inició sesión)
router.get('/pedidos/:id', pedido.obtenerPedido);
router.post('/sucursales/:id/pedidos', authenticateOpcional, pedido.crearPedido);
router.post('/pedidos/:id/generar-qr', authenticateOpcional, pedido.generarQRPedidoCtrl);
// Mesero (empleado autenticado)
router.post('/pedidos/verificar-qr', authenticate, pedido.verificarQRPedidoCtrl);
export default router;
