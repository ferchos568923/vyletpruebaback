import { prisma } from './prisma.js';
export const PLAN_GRATIS_ID = 1;
export const DIAS_DEFAULT_SUSCRIPCION = 365;
// Suscripción activa de una empresa (con su plan)
export const suscripcionActiva = async (empresaId) => {
    const hoy = new Date();
    return prisma.suscripciones.findFirst({
        where: { empresa_id: empresaId, estado: 'activa', fecha_fin: { gte: hoy } },
        orderBy: { fecha_fin: 'desc' },
        include: { planes: true }
    });
};
// Suscripción activa por cédula del usuario (vale para todas sus empresas)
export const suscripcionActivaPorCedula = async (cedula) => {
    const hoy = new Date();
    return prisma.suscripciones.findFirst({
        where: { cedula, estado: 'activa', fecha_fin: { gte: hoy } },
        orderBy: { fecha_fin: 'desc' },
        include: { planes: true }
    });
};
// Límite de sucursales de una empresa (null = ilimitado). Sin suscripción activa => plan Gratis (1)
export const limiteSucursales = async (empresaId) => {
    const sub = await suscripcionActiva(empresaId);
    const cantidad = sub?.planes?.cantidad_sucursales ?? 1;
    if (cantidad === null || cantidad >= 999999)
        return null;
    return cantidad;
};
// Límite de sucursales por cédula (aplica a todas las empresas del usuario)
export const limiteSucursalesPorCedula = async (cedula) => {
    const sub = await suscripcionActivaPorCedula(cedula);
    const cantidad = sub?.planes?.cantidad_sucursales ?? 1;
    if (cantidad === null || cantidad >= 999999)
        return null;
    return cantidad;
};
// Límite de productos/servicios de una empresa (null = ilimitado). Sin suscripción activa => plan Gratis (5)
export const limiteProductos = async (empresaId) => {
    const sub = await suscripcionActiva(empresaId);
    const cantidad = sub?.planes?.cantidad_productos ?? 5;
    if (cantidad === null || cantidad >= 999999)
        return null;
    return cantidad;
};
// Límite de productos por cédula
export const limiteProductosPorCedula = async (cedula) => {
    const sub = await suscripcionActivaPorCedula(cedula);
    const cantidad = sub?.planes?.cantidad_productos ?? 5;
    if (cantidad === null || cantidad >= 999999)
        return null;
    return cantidad;
};
// ¿El plan de la empresa permite crear cupones? Sin suscripción activa => plan Gratis (no)
export const permiteCupones = async (empresaId) => {
    const sub = await suscripcionActiva(empresaId);
    return sub?.planes?.permite_cupones === true;
};
// ¿La suscripción por cédula permite cupones?
export const permiteCuponesPorCedula = async (cedula) => {
    const sub = await suscripcionActivaPorCedula(cedula);
    return sub?.planes?.permite_cupones === true;
};
// ¿La suscripción por cédula permite cartillas?
export const permiteCartillasPorCedula = async (cedula) => {
    const sub = await suscripcionActivaPorCedula(cedula);
    return sub?.planes?.permite_cartillas === true;
};
// ¿El plan de la empresa permite reservas? Sin suscripción activa => plan Gratis (no)
export const permiteReservas = async (empresaId) => {
    const sub = await suscripcionActiva(empresaId);
    return sub?.planes?.permite_reservas === true;
};
// ¿La suscripción por cédula permite reservas?
export const permiteReservasPorCedula = async (cedula) => {
    const sub = await suscripcionActivaPorCedula(cedula);
    return sub?.planes?.permite_reservas === true;
};
// ¿La empresa tiene reservas habilitadas por su plan? (busca por cédula del dueño)
export const empresaTieneReservas = async (empresaId) => {
    const hoy = new Date();
    // Buscar dueño de la empresa
    const link = await prisma.usuario_empresas.findFirst({
        where: { empresa_id: empresaId },
        select: { usuarios: { select: { cedula: true } } }
    });
    const cedula = link?.usuarios?.cedula;
    if (!cedula)
        return false;
    const sub = await prisma.suscripciones.findFirst({
        where: { cedula, estado: 'activa', fecha_fin: { gte: hoy } },
        include: { planes: true }
    });
    return sub?.planes?.permite_reservas === true;
};
// ¿El dueño tiene una suscripción activa en alguna de sus empresas?
export const duenoTienePremium = async (usuarioId) => {
    const hoy = new Date();
    const links = await prisma.usuario_empresas.findMany({
        where: { usuario_id: usuarioId },
        select: { empresa_id: true }
    });
    const ids = links.map((l) => l.empresa_id);
    if (ids.length === 0)
        return false;
    const sub = await prisma.suscripciones.findFirst({
        where: { empresa_id: { in: ids }, estado: 'activa', fecha_fin: { gte: hoy } }
    });
    return !!sub;
};
// Cantidad de empresas activas de un dueño (vínculo o propietario por correo)
export const contarEmpresasDueno = async (usuarioId, correo) => {
    return prisma.empresas.count({
        where: {
            activo: true,
            OR: [{ usuario_empresas: { some: { usuario_id: usuarioId } } }, { propietario: correo }]
        }
    });
};
// Where de "empresas de un correo de propietario" (con vínculo de usuario si existe)
const empresasDeCorreo = async (correo) => {
    const usuario = await prisma.usuarios.findFirst({ where: { correo }, select: { id: true } });
    return usuario
        ? { OR: [{ usuario_empresas: { some: { usuario_id: usuario.id } } }, { propietario: correo }] }
        : { propietario: correo };
};
// Cantidad de empresas activas de un propietario por correo
export const contarEmpresasPorCorreo = async (correo) => {
    return prisma.empresas.count({ where: { activo: true, ...(await empresasDeCorreo(correo)) } });
};
// Límite de empresas de un propietario según sus suscripciones activas (null = ilimitado). Sin suscripción => Gratis (1)
export const limiteEmpresasPorCorreo = async (correo) => {
    const subs = await prisma.suscripciones.findMany({
        where: { empresas: await empresasDeCorreo(correo), estado: 'activa', fecha_fin: { gte: new Date() } },
        include: { planes: true }
    });
    if (subs.length === 0)
        return 1;
    const limites = subs.map((s) => s.planes?.cantidad_empresas ?? 1);
    if (limites.some((l) => l >= 999999))
        return null;
    return Math.max(...limites);
};
