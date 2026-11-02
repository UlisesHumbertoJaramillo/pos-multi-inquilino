// Rutas HTTP del módulo de catálogo. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { type Category, IMAGE_TYPES, MAX_IMAGE_BYTES, type Product } from '../dominio/catalog.js';
import { PRICE_RULES, type PriceRule } from '../dominio/price-rules.js';
import type { BranchPriceList, PriceList } from '../aplicacion/ports.js';
import type { Combo, CreateCombo, ListCombos, UpdateCombo } from '../aplicacion/combos.js';
import type {
  AssignBranchPriceList,
  CreatePriceList,
  DeactivatePriceList,
  GetPriceSheet,
  ListBranchPriceLists,
  ListPriceLists,
  PriceSheet,
  SetManualPrice,
  UpdatePriceList,
} from '../aplicacion/price-lists.js';
import type {
  CreateCategory,
  CreateProduct,
  DeactivateCategory,
  DeactivateProduct,
  GetProductImage,
  ListCategories,
  ListedProduct,
  ListProducts,
  SetProductImage,
  UpdateCategory,
  UpdateProduct,
} from '../aplicacion/products.js';

export interface CatalogUseCases {
  listCategories: ListCategories;
  createCategory: CreateCategory;
  updateCategory: UpdateCategory;
  deactivateCategory: DeactivateCategory;
  listProducts: ListProducts;
  createProduct: CreateProduct;
  updateProduct: UpdateProduct;
  deactivateProduct: DeactivateProduct;
  setProductImage: SetProductImage;
  getProductImage: GetProductImage;
  listCombos: ListCombos;
  createCombo: CreateCombo;
  updateCombo: UpdateCombo;
  listPriceLists: ListPriceLists;
  createPriceList: CreatePriceList;
  updatePriceList: UpdatePriceList;
  deactivatePriceList: DeactivatePriceList;
  getPriceSheet: GetPriceSheet;
  setManualPrice: SetManualPrice;
  listBranchPriceLists: ListBranchPriceLists;
  assignBranchPriceList: AssignBranchPriceList;
}

const idParams = z.object({ id: z.uuid() });
const priceParams = z.object({ id: z.uuid(), productoId: z.uuid() });
const includeQuery = z.object({ incluirBajas: z.enum(['true', 'false']).optional() });
const decimal = z.string().max(20);
const name = z.string().max(200);
const barcode = z.string().max(100).nullable();

const categoryBody = z.object({ nombre: name, tasaIva: decimal }).strict();
const productBody = z
  .object({ nombre: name, codigoBarras: barcode.optional(), categoriaId: z.uuid(), costo: decimal })
  .strict();
const component = z.object({ productoId: z.uuid(), cantidad: decimal }).strict();
const comboBody = z
  .object({
    nombre: name,
    codigoBarras: barcode.optional(),
    precio: decimal,
    componentes: z.array(component).max(50),
  })
  .strict();
const ruleBody = z
  .object({
    tipo: z.enum(PRICE_RULES),
    porcentaje: decimal.optional(),
    porCategoria: z.record(z.uuid(), decimal).optional(),
  })
  .strict()
  .refine((rule) => rule.tipo === 'fijo' || rule.porcentaje !== undefined, {
    message: 'Falta el porcentaje de la regla.',
  });
const listBody = z.object({ nombre: name, regla: ruleBody }).strict();
const manualPriceBody = z.object({ precio: decimal.nullable() }).strict();
const assignBody = z.object({ listaId: z.uuid() }).strict();

const toRule = (rule: z.infer<typeof ruleBody>): PriceRule => {
  switch (rule.tipo) {
    case 'fijo':
      return { type: 'fijo' };
    case 'porcentaje_costo':
      return { type: 'porcentaje_costo', markupPct: rule.porcentaje ?? '' };
    case 'por_grupo':
      return {
        type: 'por_grupo',
        markupPct: rule.porcentaje ?? '',
        byCategory: rule.porCategoria ?? {},
      };
  }
};

const ruleDto = (rule: PriceRule) => {
  switch (rule.type) {
    case 'fijo':
      return { tipo: rule.type };
    case 'porcentaje_costo':
      return { tipo: rule.type, porcentaje: rule.markupPct };
    case 'por_grupo':
      return { tipo: rule.type, porcentaje: rule.markupPct, porCategoria: rule.byCategory };
  }
};

const categoryDto = (c: Category) => ({
  id: c.id,
  nombre: c.name,
  tasaIva: c.vatRate,
  activa: c.isActive,
});
const productDto = (p: Product, sellable = p.isActive) => ({
  id: p.id,
  tipo: p.type,
  nombre: p.name,
  codigoBarras: p.barcode,
  categoriaId: p.categoryId,
  costo: p.cost,
  precioCombo: p.comboPrice,
  activo: p.isActive,
  tieneImagen: p.hasImage,
  disponible: sellable,
});
const comboDto = (c: Combo) => ({
  ...productDto(c.product, c.sellable),
  componentes: c.components.map((component) => ({
    productoId: component.productId,
    nombre: component.productName,
    cantidad: component.quantity,
    activo: component.productActive,
  })),
});
const listDto = (l: PriceList) => ({
  id: l.id,
  nombre: l.name,
  regla: ruleDto(l.rule),
  activa: l.isActive,
});
const sheetDto = (s: PriceSheet) => ({
  lista: listDto(s.list),
  precios: s.rows.map((row) => ({
    productoId: row.productId,
    nombre: row.name,
    codigoBarras: row.barcode,
    tipo: row.type,
    categoria: row.categoryName,
    precioFinal: row.price,
  })),
});
const branchListDto = (b: BranchPriceList) => ({
  sucursalId: b.branchId,
  nombre: b.branchName,
  listaId: b.priceListId,
});

const CATALOG = 'catalogo.gestionar' as const;

export function catalogRoutes(useCases: CatalogUseCases): HttpRoute[] {
  return [
    // Categorías (RF-029).
    {
      method: 'get',
      path: '/catalogo/categorias',
      action: CATALOG,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const list = await useCases.listCategories.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(list.map(categoryDto));
      },
    },
    {
      method: 'post',
      path: '/catalogo/categorias',
      action: CATALOG,
      handler: async (req, res) => {
        const body = parseInput(categoryBody, req.body);
        const category = await useCases.createCategory.execute(securityContextOf(res), {
          name: body.nombre,
          vatRate: body.tasaIva,
        });
        res.status(201).json(categoryDto(category));
      },
    },
    {
      method: 'patch',
      path: '/catalogo/categorias/:id',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(categoryBody.partial().strict(), req.body);
        const category = await useCases.updateCategory.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.tasaIva === undefined ? {} : { vatRate: body.tasaIva }),
        });
        res.json(categoryDto(category));
      },
    },
    {
      method: 'post',
      path: '/catalogo/categorias/:id/baja',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateCategory.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    // Productos e imágenes (RF-130, RF-131, RF-159).
    {
      method: 'get',
      path: '/catalogo/productos',
      action: CATALOG,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const list = await useCases.listProducts.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(list.map((p: ListedProduct) => productDto(p, p.sellable)));
      },
    },
    {
      method: 'post',
      path: '/catalogo/productos',
      action: CATALOG,
      handler: async (req, res) => {
        const body = parseInput(productBody, req.body);
        const product = await useCases.createProduct.execute(securityContextOf(res), {
          name: body.nombre,
          barcode: body.codigoBarras ?? null,
          categoryId: body.categoriaId,
          cost: body.costo,
        });
        res.status(201).json(productDto(product));
      },
    },
    {
      method: 'patch',
      path: '/catalogo/productos/:id',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(productBody.partial().strict(), req.body);
        const product = await useCases.updateProduct.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.codigoBarras === undefined ? {} : { barcode: body.codigoBarras }),
          ...(body.categoriaId === undefined ? {} : { categoryId: body.categoriaId }),
          ...(body.costo === undefined ? {} : { cost: body.costo }),
        });
        res.json(productDto(product));
      },
    },
    {
      method: 'post',
      path: '/catalogo/productos/:id/baja',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateProduct.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'put',
      path: '/catalogo/productos/:id/imagen',
      action: CATALOG,
      binaryBody: { types: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES },
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body: unknown = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw new ApplicationError(
            'invalid_request',
            'IMAGEN_INVALIDA',
            'Enviá la imagen como PNG, JPEG o WebP, de hasta 1 MB.',
          );
        }
        await useCases.setProductImage.execute(securityContextOf(res), id, new Uint8Array(body));
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/catalogo/productos/:id/imagen',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const image = await useCases.getProductImage.execute(securityContextOf(res), id);
        res
          .type(image.type)
          .set('Cache-Control', 'private, max-age=300')
          .send(Buffer.from(image.bytes));
      },
    },
    // Combos (RF-049, RF-149).
    {
      method: 'get',
      path: '/catalogo/combos',
      action: CATALOG,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const list = await useCases.listCombos.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(list.map(comboDto));
      },
    },
    {
      method: 'post',
      path: '/catalogo/combos',
      action: CATALOG,
      handler: async (req, res) => {
        const body = parseInput(comboBody, req.body);
        const combo = await useCases.createCombo.execute(securityContextOf(res), {
          name: body.nombre,
          barcode: body.codigoBarras ?? null,
          price: body.precio,
          components: body.componentes.map((c) => ({
            productId: c.productoId,
            quantity: c.cantidad,
          })),
        });
        res.status(201).json(comboDto(combo));
      },
    },
    {
      method: 'patch',
      path: '/catalogo/combos/:id',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(comboBody.partial().strict(), req.body);
        const combo = await useCases.updateCombo.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.codigoBarras === undefined ? {} : { barcode: body.codigoBarras }),
          ...(body.precio === undefined ? {} : { price: body.precio }),
          ...(body.componentes === undefined
            ? {}
            : {
                components: body.componentes.map((c) => ({
                  productId: c.productoId,
                  quantity: c.cantidad,
                })),
              }),
        });
        res.json(comboDto(combo));
      },
    },
    // Listas de precios (RF-028, RF-032, RF-033).
    {
      method: 'get',
      path: '/catalogo/listas',
      action: CATALOG,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const list = await useCases.listPriceLists.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(list.map(listDto));
      },
    },
    {
      method: 'post',
      path: '/catalogo/listas',
      action: CATALOG,
      handler: async (req, res) => {
        const body = parseInput(listBody, req.body);
        const list = await useCases.createPriceList.execute(securityContextOf(res), {
          name: body.nombre,
          rule: toRule(body.regla),
        });
        res.status(201).json(listDto(list));
      },
    },
    {
      method: 'patch',
      path: '/catalogo/listas/:id',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(
          z.object({ nombre: name.optional(), regla: ruleBody.optional() }).strict(),
          req.body,
        );
        const list = await useCases.updatePriceList.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.regla === undefined ? {} : { rule: toRule(body.regla) }),
        });
        res.json(listDto(list));
      },
    },
    {
      method: 'post',
      path: '/catalogo/listas/:id/baja',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivatePriceList.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/catalogo/listas/:id/precios',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const sheet = await useCases.getPriceSheet.execute(securityContextOf(res), id);
        res.json(sheetDto(sheet));
      },
    },
    {
      method: 'put',
      path: '/catalogo/listas/:id/precios/:productoId',
      action: CATALOG,
      handler: async (req, res) => {
        const { id, productoId } = parseInput(priceParams, req.params);
        const body = parseInput(manualPriceBody, req.body);
        await useCases.setManualPrice.execute(securityContextOf(res), id, productoId, body.precio);
        res.status(204).end();
      },
    },
    // Lista activa de cada sucursal (RF-119).
    {
      method: 'get',
      path: '/catalogo/sucursales',
      action: CATALOG,
      handler: async (_req, res) => {
        const list = await useCases.listBranchPriceLists.execute(securityContextOf(res));
        res.json(list.map(branchListDto));
      },
    },
    {
      method: 'put',
      path: '/catalogo/sucursales/:id/lista',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(assignBody, req.body);
        const branch = await useCases.assignBranchPriceList.execute(
          securityContextOf(res),
          id,
          body.listaId,
        );
        res.json(branchListDto(branch));
      },
    },
  ];
}
