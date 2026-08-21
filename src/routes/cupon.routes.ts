import { Router } from 'express';
import * as cupon from '../controllers/cupon.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.get('/sucursales/:id/cupones', cupon.listPublic);
router.get('/sucursales/:id/cupones/todos', authenticate, cupon.adminList);
router.get('/sucursales/:id/cupones/canjes', authenticate, cupon.adminCanjes);
router.post('/sucursales/:id/cupones', authenticate, cupon.adminCreate);
router.patch('/sucursales/:id/cupones/:cuponId', authenticate, cupon.adminUpdate);
router.delete('/sucursales/:id/cupones/:cuponId', authenticate, cupon.adminRemove);
router.post('/cupones/:id/canjear', authenticate, cupon.canjear);
router.get('/mis-cupones', authenticate, cupon.misCupones);

export default router;