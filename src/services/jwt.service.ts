import jwt from 'jsonwebtoken';
import { config } from 'dotenv';

config();

const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_super_seguro_cambiar_en_produccion';
const JWT_EXPIRES_IN = '7d'; // 7 días

export const generateToken = (userId: number, email: string, rolId?: number) => {
  return jwt.sign(
    { userId, email, rolId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};