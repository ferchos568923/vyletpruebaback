import { prisma } from './prisma.js';

export const verificarAccesoSucursal = async (userId: number, sucursalId: number): Promise<boolean> => {
  const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId }, select: { empresa_id: true } });
  if (!sucursal) return false;

  const dueno = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: userId, empresa_id: sucursal.empresa_id }
  });
  if (dueno) return true;

  const empresa = await prisma.empresas.findUnique({ where: { id: sucursal.empresa_id }, select: { propietario: true } });
  if (empresa?.propietario) {
    const usuario = await prisma.usuarios.findUnique({ where: { id: userId }, select: { correo: true } });
    if (usuario?.correo === empresa.propietario) return true;
  }

  const empleado = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: userId, empresa_id: sucursal.empresa_id, activo: true },
    include: { empleado_sucursales: { where: { sucursal_id: sucursalId } } }
  });
  if (empleado && empleado.empleado_sucursales.length > 0) return true;

  return false;
};
