export type TransactionStatus = "pending" | "paid";
export type ActorRole = "owner" | "cashier";
export type ActorType = "owner" | "team_member";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Merchant {
  id: string;
  userId: string;
  businessName: string;
  city: string;
  category: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  merchantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: ActorRole;
  active: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  sku: string;
  price: number;
  active: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  merchantId: string;
  productId: string | null;
  amount: number;
  status: TransactionStatus;
  customerName: string;
  notes: string;
  qrisPayload: string;
  createdAt: string;
  paidAt: string | null;
}

export interface Session {
  token: string;
  merchantId: string;
  actorType: ActorType;
  actorId: string;
  role: ActorRole;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  merchantId: string;
  actorType: ActorType;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export interface Database {
  users: User[];
  merchants: Merchant[];
  teamMembers: TeamMember[];
  products: Product[];
  transactions: Transaction[];
  sessions: Session[];
  auditLogs: AuditLog[];
}
