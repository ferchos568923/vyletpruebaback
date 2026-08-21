import { Router } from 'express';
import { buscarSucursalesPorProducto } from '../controllers/busqueda.controller.js';
const router = Router();
// Público
router.get('/buscar', buscarSucursalesPorProducto);
export default router;
