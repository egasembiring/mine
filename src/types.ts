export type TransactionStatus = "pending" | "paid";

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
  userId: string;
  createdAt: string;
}

export interface Database {
  users: User[];
  merchants: Merchant[];
  products: Product[];
  transactions: Transaction[];
  sessions: Session[];
}
