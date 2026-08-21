import { Router } from 'express';
import * as uploadCtrl from '../controllers/upload.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.post('/upload', authenticate, uploadCtrl.upload);

export default router;