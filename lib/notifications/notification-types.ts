/**
 * lib/notifications/notification-types.ts
 *
 * Sprint 37: Shared types for the unified notifications center.
 * No server dependencies — safe to import from client components.
 */

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export type NotificationCategory =
  | "deployment"
  | "backup"
  | "domain"
  | "storage"
  | "job"
  | "alert"
  | "security"
  | "admin"
  | "system";

export type UserNotificationDTO = {
  id:          string;
  userId:      string;
  projectId:   string | null;
  projectName: string | null;
  title:       string;
  body:        string | null;
  severity:    NotificationSeverity;
  category:    NotificationCategory;
  sourceType:  string | null;
  sourceId:    string | null;
  href:        string | null;
  readAt:      string | null;
  dismissedAt: string | null;
  createdAt:   string;
};

export type CreateNotificationInput = {
  userId:      string;
  projectId?:  string;
  title:       string;
  body?:       string;
  severity?:   NotificationSeverity;
  category:    NotificationCategory;
  sourceType?: string;
  sourceId?:   string;
  href?:       string;
  metadata?:   Record<string, unknown>;
};

export type ListNotificationsFilter = {
  unreadOnly?:  boolean;
  dismissed?:   boolean;
  category?:    NotificationCategory;
  projectId?:   string;
  page?:        number;
  pageSize?:    number;
};

export type ListNotificationsOutput = {
  notifications: UserNotificationDTO[];
  total:         number;
  unreadCount:   number;
  page:          number;
  pageSize:      number;
  totalPages:    number;
};
