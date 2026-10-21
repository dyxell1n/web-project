import { Router, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password, name, adminRegistrationCode } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await AuthService.register(email, password, name, adminRegistrationCode);
    res.status(201).json({
      message: 'Account created successfully',
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === 'Invalid admin registration code' ? 403 : 400).json({ error: message });
  }
});

// POST /api/auth/login
router.post('/login', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await AuthService.login(email, password);
    res.json({
      message: 'Login successful',
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    res.status(401).json({ error: (error as Error).message });
  }
});

// GET /api/auth/me (Protected)
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  res.json({
    user: req.user,
  });
});

export default router;
