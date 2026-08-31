import { prisma } from '../services/prisma.js';
const error500 = (res, err, msg) => {
    console.error(msg, err);
    res.status(500).json({ error: msg });
};
const isUniqueError = (e) => e?.code === 'P2002';
function crud({ delegate, campos, numericos = [], booleanos = [], unicos = [], soft = true }) {
    const parseData = (body) => {
        const data = {};
        for (const c of campos) {
            if (body[c] !== undefined) {
                if (numericos.includes(c))
                    data[c] = Number(body[c]);
                else if (booleanos.includes(c))
                    data[c] = Boolean(body[c]);
                else
                    data[c] = body[c];
            }
        }
        return data;
    };
    const listar = async (req, res) => {
        try {
            const items = await delegate.findMany({ orderBy: { id: 'asc' } });
            res.json(items);
        }
        catch (e) {
            error500(res, e, 'Error al listar registros');
        }
    };
    const crear = async (req, res) => {
        try {
            const data = parseData(req.body);
            for (const u of unicos) {
                if (req.body[u] !== undefined) {
                    const existe = await delegate.findUnique?.({ where: { [u]: req.body[u] } });
                    if (existe)
                        return res.status(400).json({ error: `Ya existe un registro con ese ${u}` });
                }
            }
            const creado = await delegate.create({ data });
            res.status(201).json(creado);
        }
        catch (e) {
            if (isUniqueError(e))
                return res.status(400).json({ error: 'Ya existe un registro con ese valor' });
            error500(res, e, 'Error al crear registro');
        }
    };
    const actualizar = async (req, res) => {
        try {
            const id = Number(req.params.id);
            const data = parseData(req.body);
            for (const u of unicos) {
                if (req.body[u] !== undefined) {
                    const existe = await delegate.findUnique?.({ where: { [u]: req.body[u] } });
                    if (existe && existe.id !== id)
                        return res.status(400).json({ error: `Ya existe un registro con ese ${u}` });
                }
            }
            const actualizado = await delegate.update({ where: { id }, data });
            res.json(actualizado);
        }
        catch (e) {
            if (isUniqueError(e))
                return res.status(400).json({ error: 'Ya existe un registro con ese valor' });
            error500(res, e, 'Error al actualizar registro');
        }
    };
    const eliminar = async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (soft) {
                await delegate.update({ where: { id }, data: { activo: false } });
                res.json({ message: 'Registro desactivado' });
            }
            else {
                await delegate.delete({ where: { id } });
                res.json({ message: 'Registro eliminado' });
            }
        }
        catch (e) {
            error500(res, e, 'Error al eliminar registro');
        }
    };
    return { listar, crear, actualizar, eliminar };
}
export const adminProvincias = crud({
    delegate: prisma.provincias,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    unicos: ['nombre'],
    soft: true
});
export const adminCiudades = crud({
    delegate: prisma.ciudades,
    campos: ['provincia_id', 'nombre', 'slug', 'descripcion', 'historia', 'imagen_principal', 'altitud', 'temperatura_min', 'temperatura_max', 'poblacion', 'distincion', 'es_turistica', 'activo'],
    numericos: ['provincia_id', 'altitud', 'temperatura_min', 'temperatura_max', 'poblacion'],
    booleanos: ['es_turistica', 'activo'],
    soft: true
});
export const adminCategorias = crud({
    delegate: prisma.categorias_negocio,
    campos: ['nombre', 'descripcion', 'icono', 'color', 'permite_productos', 'permite_reservas', 'permite_habitaciones', 'activo'],
    booleanos: ['permite_productos', 'permite_reservas', 'permite_habitaciones', 'activo'],
    unicos: ['nombre'],
    soft: true
});
export const adminServicios = crud({
    delegate: prisma.servicios,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    soft: true
});
export const adminTiposInteres = crud({
    delegate: prisma.tipos_interes,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    soft: true
});
export const adminCargos = crud({
    delegate: prisma.cargos_empresa,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    soft: true
});
export const adminEtiquetas = crud({
    delegate: prisma.etiquetas,
    campos: ['nombre'],
    soft: false
});
export const adminCategoriasEvento = crud({
    delegate: prisma.categorias_evento,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    unicos: ['nombre'],
    soft: true
});
export const adminCategoriasProducto = crud({
    delegate: prisma.categorias_producto,
    campos: ['nombre', 'descripcion', 'activo'],
    booleanos: ['activo'],
    soft: true
});
export const adminPermisosEmpresa = crud({
    delegate: prisma.permisos_empresa,
    campos: ['nombre', 'descripcion'],
    soft: false
});
