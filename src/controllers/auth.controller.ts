import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/prisma.js';
import { generateToken } from '../services/jwt.service.js';

// Registrar un nuevo usuario
export const register = async (req: Request, res: Response) => {
  try {
    const { nombres, apellidos, correo, telefono, clave, genero, fecha_nacimiento, cedula, tipo } = req.body;

    // Validar que el correo no esté registrado
    const existingUser = await prisma.usuarios.findUnique({
      where: { correo }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    if (cedula) {
      const conCedula = await prisma.usuarios.findUnique({ where: { cedula } });
      if (conCedula) {
        return res.status(400).json({ error: 'La cédula ya está registrada' });
      }
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(clave, 10);

    // Buscar rol por defecto 'cliente'
    let rolUsuario = await prisma.roles.findFirst({
      where: { nombre: 'cliente' }
    });

    if (!rolUsuario) {
      // Si no existe, crear el rol cliente por defecto
      rolUsuario = await prisma.roles.create({
        data: { nombre: 'cliente', activo: true }
      });
    }

    // Crear usuario
    const newUser = await prisma.usuarios.create({
      data: {
        cedula: cedula || null,
        nombres,
        apellidos,
        correo,
        telefono,
        clave: hashedPassword,
        genero,
        fecha_nacimiento: fecha_nacimiento ? new Date(fecha_nacimiento) : null,
        activo: true,
        correo_verificado: false,
        rol_id: rolUsuario.id
      },
      include: { roles: true }
    });

    // Vincular el rol en usuario_roles (soporta multiroles)
    await prisma.usuario_roles.create({
      data: { usuario_id: newUser.id, rol_id: rolUsuario.id }
    });

    // Generar token JWT
    const token = generateToken(Number(newUser.id), newUser.correo, newUser.rol_id || undefined);

    // Si pidió ser dueño, registrar la solicitud (queda en cliente hasta aprobación del admin)
    const esDueno = tipo === 'dueno' || tipo === 'dueño';
    let solicitud_id: number | null = null;
    if (esDueno) {
      const solicitud = await prisma.solicitudes_dueno.create({
        data: { usuario_id: newUser.id, estado: 'pendiente' }
      });
      solicitud_id = solicitud.id;
    }

    // Responder sin enviar la contraseña
    const { clave: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: esDueno
        ? 'Usuario registrado. Tu solicitud para ser dueño de negocio fue enviada y está pendiente de aprobación.'
        : 'Usuario registrado exitosamente',
      token,
      user: userWithoutPassword,
      solicitud_id,
      solicitud_pendiente: esDueno
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
};

// Login de usuario
export const login = async (req: Request, res: Response) => {
  try {
    const { correo, clave } = req.body;

    if (!correo || !clave) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
    }

    // Buscar usuario por correo
    const user = await prisma.usuarios.findUnique({
      where: { correo },
      include: { roles: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.activo) {
      return res.status(401).json({ error: 'Cuenta desactivada' });
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(clave, user.clave);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Actualizar último acceso
    await prisma.usuarios.update({
      where: { id: user.id },
      data: { ultimo_acceso: new Date() }
    });

    // Generar token
    const token = generateToken(Number(user.id), user.correo, user.rol_id || undefined);

    // Responder sin enviar la contraseña
    const { clave: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login exitoso',
      token,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

// Obtener perfil del usuario autenticado
export const getProfile = async (req: Request, res: Response) => {
  try {
    // El usuario ya está en req.user gracias al middleware authenticate
    const user = req.user;
    const { clave: _, ...userWithoutPassword } = user;
    res.json({ ...userWithoutPassword, permisos: req.permisos || [] });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
};