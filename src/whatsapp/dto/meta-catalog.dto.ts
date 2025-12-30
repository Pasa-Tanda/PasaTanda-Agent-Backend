export interface MetaProductItem {
  id: string; // retailer_id
  title: string;
  description: string;
  price: string; // Format: "100.00 USD"
  image_link?: string;
  link?: string;
  availability:
    | 'in stock'
    | 'out of stock'
    | 'preorder'
    | 'available for order'
    | 'discontinued';
  condition: 'new' | 'refurbished' | 'used';
  brand?: string;
  category?: string;
  inventory?: number;
  currency?: string;
  sale_price?: string;
  sale_price_start_date?: string;
  sale_price_end_date?: string;
}

export interface MetaBatchRequest {
  method: 'CREATE' | 'UPDATE' | 'DELETE';
  retailer_id: string;
  data?: Partial<MetaProductItem>;
}

export interface MetaBatchResponse {
  handles: string[];
  validation_status: Array<{
    retailer_id: string;
    errors?: Array<{ message: string }>;
    warnings?: Array<{ message: string }>;
  }>;
}

export interface MetaCatalogProduct {
  retailer_id: string;
  id: string;
  name: string;
  price: string;
  availability: string;
  image_url?: string;
  inventory?: number;
  description?: string;
}

export interface MetaCatalogListResponse {
  data: MetaCatalogProduct[];
  paging?: {
    cursors?: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

export interface SyncInventoryResult {
  synced: number;
  errors: number;
  warnings: number;
  details: Array<{
    retailer_id: string;
    status: 'success' | 'error' | 'warning';
    message?: string;
  }>;
}
