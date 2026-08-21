import { Router } from 'express';
import * as cat from '../controllers/catalogo.admin.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';
const router = Router();
const registros = [
    { ruta: 'provincias', c: cat.adminProvincias },
    { ruta: 'ciudades', c: cat.adminCiudades },
    { ruta: 'categorias-negocio', c: cat.adminCategorias },
    { ruta: 'servicios', c: cat.adminServicios },
    { ruta: 'tipos-interes', c: cat.adminTiposInteres },
    { ruta: 'cargos-empresa', c: cat.adminCargos },
    { ruta: 'etiquetas', c: cat.adminEtiquetas },
    { ruta: 'categorias-evento', c: cat.adminCategoriasEvento },
    { ruta: 'categorias-producto', c: cat.adminCategoriasProducto },
    { ruta: 'permisos-empresa', c: cat.adminPermisosEmpresa }
];
for (const { ruta, c } of registros) {
    router.get(`/${ruta}`, authenticate, requirePermiso('configuraciones:ver'), c.listar);
    router.post(`/${ruta}`, authenticate, requirePermiso('configuraciones:editar'), c.crear);
    router.patch(`/${ruta}/:id`, authenticate, requirePermiso('configuraciones:editar'), c.actualizar);
    router.delete(`/${ruta}/:id`, authenticate, requirePermiso('configuraciones:editar'), c.eliminar);
}
export default router;
