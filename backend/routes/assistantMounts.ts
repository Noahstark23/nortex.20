import type { Express } from 'express';
import assistantRouter from './assistant.js';
import { buildAssistantDocumentsRouter } from './assistantDocuments.js';
import { createAssistantProposalsRouter } from './assistantProposals.js';
import { createAssistantCatalogRouter } from './assistantCatalog.js';
import { createAssistantActionsRouter } from './assistantActions.js';
import { createAssistantOperationsRouter } from './assistantOperations.js';
import { createAssistantStatusRouter } from './assistantStatus.js';
import { buildAssistantPrivateWhatsappRouter } from './assistantPrivateWhatsapp.js';
import { createAssistantBudgetRouter, createAdminAssistantBudgetRouter } from './assistantBudget.js';

/** Conserva el orden de autenticación y rutas del asistente y sus canales. */
export function mountAssistantRoutes(app: Express) {
  app.use('/api/assistant', assistantRouter);
  app.use('/api/assistant', buildAssistantDocumentsRouter());
  app.use('/api/assistant', createAssistantOperationsRouter());
  app.use('/api/assistant', createAssistantStatusRouter());
  app.use('/api/assistant', createAssistantActionsRouter());
  app.use('/api/assistant/private-whatsapp', buildAssistantPrivateWhatsappRouter());
  app.use('/api/assistant', createAssistantCatalogRouter());
  app.use('/api/assistant', createAssistantProposalsRouter());
  app.use('/api/assistant', createAssistantBudgetRouter());
  app.use('/api/admin/assistant-budget', createAdminAssistantBudgetRouter());
}
