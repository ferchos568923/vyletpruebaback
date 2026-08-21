import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/jwt.service.js';
import { prisma } from '../services/prisma.js';

// Extender el tipo Request para agregar el usuario y sus permisos
declare global {
  namespace Express {
    interface Request {
      user?: any;
      permisos?: string[];
    }
  }
}

const STAFF_ROLES = ['admin', 'gerente', 'superadmin'];

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Buscar usuario en la base de datos para asegurar que existe y está activo
  const user = await prisma.usuarios.findUnique({
    where: { id: (decoded as any).userId },
    include: { roles: true }
  });

  if (!user || !user.activo) {
    return res.status(401).json({ error: 'Usuario no autorizado' });
  }

  // Cargar permisos: por rol_id (FK) y por usuario_roles (multiroles)
  const rolIds = new Set<number>();
  if (user.roles?.id) rolIds.add(user.roles.id);
  const junction = await prisma.usuario_roles.findMany({
    where: { usuario_id: user.id },
    select: { rol_id: true }
  });
  junction.forEach((r) => rolIds.add(r.rol_id));

  const perms = await prisma.rol_permisos.findMany({
    where: { rol_id: { in: [...rolIds] } },
    include: { permisos: true }
  });

  req.permisos = [...new Set(perms.map((p) => p.permisos.nombre))];
  req.user = user;
  next();
};

// Igual que authenticate pero opcional: si no hay token (o es inválido) continúa sin usuario.
export const authenticateOpcional = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  const decoded = verifyToken(authHeader.split(' ')[1]);
  if (!decoded) return next();
  const user = await prisma.usuarios.findUnique({
    where: { id: (decoded as any).userId },
    include: { roles: true }
  });
  if (!user || !user.activo) return next();

  const rolIds = new Set<number>();
  if (user.roles?.id) rolIds.add(user.roles.id);
  const junction = await prisma.usuario_roles.findMany({
    where: { usuario_id: user.id },
    select: { rol_id: true }
  });
  junction.forEach((r) => rolIds.add(r.rol_id));
  const perms = await prisma.rol_permisos.findMany({
    where: { rol_id: { in: [...rolIds] } },
    include: { permisos: true }
  });
  req.permisos = [...new Set(perms.map((p) => p.permisos.nombre))];
  req.user = user;
  next();
};

// ¿El usuario es un empleado activo de alguna empresa? (para decidir gating de sucursales)
export const esEmpleadoActivo = async (userId: number): Promise<boolean> => {
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: userId, activo: true }
  });
  return Boolean(emp);
};

// ¿El usuario puede gestionar esta sucursal? (staff, dueño/usuario_empresa, o empleado asignado a la sucursal)
export const canGestionarSucursal = async (req: Request, sucursal: { id: number; empresa_id: number }): Promise<boolean> => {
  if (isStaff(req)) return true;
  const link = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: req.user.id, empresa_id: sucursal.empresa_id }
  });
  if (link) return true;
  const negocio = await prisma.empresas.findUnique({
    where: { id: sucursal.empresa_id },
    select: { propietario: true }
  });
  if (negocio?.propietario === req.user.correo) return true;
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: req.user.id, empresa_id: sucursal.empresa_id, activo: true },
    include: { empleado_sucursales: { where: { sucursal_id: sucursal.id } } }
  });
  if (!emp) return false;
  return emp.empleado_sucursales.length > 0;
};

// ¿El empleado tiene asignada esta sucursal? (para el endpoint de mis-sucursales y filtrado)
export const empleadoTieneSucursal = async (userId: number, sucursalId: number): Promise<boolean> => {
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: userId, activo: true, empleado_sucursales: { some: { sucursal_id: sucursalId } } }
  });
  return Boolean(emp);
};

// Sucursales de la empresa asignadas al empleado activo (o null si el usuario no es empleado de la empresa)
export const sucursalesAsignadasEmpleado = async (
  userId: number,
  empresaId: number
): Promise<number[] | null> => {
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: userId, empresa_id: empresaId, activo: true },
    include: { empleado_sucursales: { select: { sucursal_id: true } } }
  });
  if (!emp) return null;
  return emp.empleado_sucursales.map((e) => e.sucursal_id);
};

// Middleware: carga la sucursal y exige permiso de plataforma (si el usuario NO es empleado) o acceso de empleado asignado.
// Establece req.sucursal para que el controlador no vuelva a consultarla.
export const requireSucursalAcceso = (plataformaPermiso: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const id = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id } });
    if (!sucursal) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }
    if (hasPermiso(req, plataformaPermiso) && !(await esEmpleadoActivo(req.user.id))) {
      (req as any).sucursal = sucursal;
      return next();
    }
    if (await canGestionarSucursal(req, sucursal)) {
      (req as any).sucursal = sucursal;
      return next();
    }
    return res.status(403).json({ error: 'No puedes gestionar esta sucursal' });
  };
};

export const hasPermiso = (req: Request, permiso: string): boolean =>
  !!req.permisos && req.permisos.includes(permiso);

export const requirePermiso = (permiso: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!hasPermiso(req, permiso)) {
      return res.status(403).json({ error: `No tienes el permiso requerido: ${permiso}` });
    }
    next();
  };
};

// Personal de la plataforma (acceso total)
export const isStaff = (req: Request): boolean => {
  const rol = req.user?.roles?.nombre;
  return STAFF_ROLES.includes(rol);
};

// ¿El usuario puede gestionar esta empresa? (staff, vinculado a ella o propietario)
export const canGestionarEmpresa = async (req: Request, empresaId: number): Promise<boolean> => {
  if (isStaff(req)) return true;
  const link = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: req.user.id, empresa_id: empresaId }
  });
  if (link) return true;
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: req.user.id, empresa_id: empresaId, activo: true }
  });
  if (emp) return true;
  const negocio = await prisma.empresas.findUnique({
    where: { id: empresaId },
    select: { propietario: true }
  });
  return negocio?.propietario === req.user.correo;
};

// ¿El usuario puede gestionar empleados de esta empresa? (solo staff, dueño o propietario, no empleados)
export const canGestionarEmpleados = async (req: Request, empresaId: number): Promise<boolean> => {
  if (isStaff(req)) return true;
  const link = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: req.user.id, empresa_id: empresaId }
  });
  if (link) return true;
  const negocio = await prisma.empresas.findUnique({
    where: { id: empresaId },
    select: { propietario: true }
  });
  return negocio?.propietario === req.user.correo;
};

// ¿El usuario puede gestionar esta empresa o es un empleado con un permiso de empresa específico?
export const canGestionarEmpresaConPermiso = async (
  req: Request,
  empresaId: number,
  permisoNombre: string
): Promise<boolean> => {
  if (isStaff(req)) return true;
  const link = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: req.user.id, empresa_id: empresaId }
  });
  if (link) return true;
  const emp = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: req.user.id, empresa_id: empresaId, activo: true },
    include: { empleado_permisos: { include: { permisos_empresa: true } } }
  });
  if (emp) return emp.empleado_permisos.some((p) => p.permisos_empresa.nombre === permisoNombre);
  const negocio = await prisma.empresas.findUnique({
    where: { id: empresaId },
    select: { propietario: true }
  });
  return negocio?.propietario === req.user.correo;
};

// Middleware opcional para roles específicos (compatibilidad)
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const userRol = req.user.roles?.nombre || req.user.rol || '';
    if (!allowedRoles.includes(userRol)) {
      return res.status(403).json({ error: 'No tienes permisos suficientes' });
    }
    next();
  };
};