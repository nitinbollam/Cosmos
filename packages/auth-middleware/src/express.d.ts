declare global {
  namespace Express {
    interface Request {
      callingService?: string
    }
  }
}

export {}
