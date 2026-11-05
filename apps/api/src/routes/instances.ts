import {
  createInstanceRoute,
  DEFAULT_INSTANCE_COLORS,
  deleteInstanceImageRoute,
  deleteInstanceRoute,
  getInstanceRoute,
  type Instance,
  type InstanceColors,
  listInstancesRoute,
  MAX_BACKGROUND_BYTES,
  MAX_IMAGE_BYTES,
  updateInstanceAppearanceRoute,
  updateInstanceRoute,
  uploadInstanceImageRoute,
} from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { storeUploadedImage, upsertImageBlob } from "../images";
import { ensureDefaultBackground, instanceExists, listInstances, readInstance } from "../instances";
import { checkVersions } from "../loaders";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";
import { metadataUnavailable } from "./loaders";

const upperColors = (colors: InstanceColors): InstanceColors => ({
  primary: colors.primary.toUpperCase(),
  primaryDark: colors.primaryDark.toUpperCase(),
  background: colors.background.toUpperCase(),
  text: colors.text.toUpperCase(),
});

/** Reads an instance that was just written; it exists, since nothing else deletes it in between. */
async function readWritten(c: Context<AppEnv>, id: string): Promise<Instance> {
  const instance = await readInstance(c.var.platform.db, c.var.platform.config, id);
  if (!instance) throw new Error(`Instance ${id} disappeared`);
  return instance;
}

const notFound = (c: Context<AppEnv>) => problem(c, 404, "not_found", "No such instance");

export function registerInstances(app: OpenAPIHono<AppEnv>) {
  app.openapi(listInstancesRoute, async (c) => {
    const { db, config } = c.var.platform;
    return c.json(await listInstances(db, config), 200);
  });

  app.openapi(createInstanceRoute, async (c) => {
    const body = c.req.valid("json");
    const { db, blobs } = c.var.platform;
    if (body.loader !== "vanilla" && !body.loaderVersion) {
      return problem(c, 400, "validation_error", "Invalid request", "loaderVersion: Required");
    }
    if (await instanceExists(db, body.id)) {
      return problem(c, 409, "instance_exists", "An instance with that id already exists");
    }
    try {
      const invalid = await checkVersions(
        c.var.platform.fetch,
        body.mcVersion,
        body.loader,
        body.loaderVersion,
      );
      if (invalid) return problem(c, 400, "invalid_version", "Invalid version", invalid);
    } catch (error) {
      return metadataUnavailable(c, error);
    }

    const background = await ensureDefaultBackground(blobs);
    try {
      await db.batch([
        upsertImageBlob(db, background),
        db.insert(schema.instances).values({
          id: body.id,
          name: body.name,
          description: body.description,
          backgroundBlob: background.sha256,
          colors: { ...DEFAULT_INSTANCE_COLORS },
          mcVersion: body.mcVersion,
          loader: body.loader,
          loaderVersion: body.loader === "vanilla" ? null : body.loaderVersion,
        }),
        db.insert(schema.instanceManagedDirs).values({ instanceId: body.id, path: "mods" }),
        db.insert(schema.auditLog).values({
          adminId: c.var.admin.id,
          action: "instance.created",
          target: body.id,
          details: { name: body.name },
        }),
      ]);
    } catch (error) {
      // Two admins creating the same id at once: the primary key decides.
      if (await instanceExists(db, body.id)) {
        return problem(c, 409, "instance_exists", "An instance with that id already exists");
      }
      throw error;
    }

    return c.json(await readWritten(c, body.id), 201);
  });

  app.openapi(getInstanceRoute, async (c) => {
    const { db, config } = c.var.platform;
    const instance = await readInstance(db, config, c.req.valid("param").id);
    return instance ? c.json(instance, 200) : notFound(c);
  });

  app.openapi(updateInstanceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const update = c.req.valid("json");
    const { db } = c.var.platform;
    const [before] = await db.select().from(schema.instances).where(eq(schema.instances.id, id));
    if (!before) return notFound(c);

    const changed = (Object.keys(update) as (keyof typeof update)[]).filter(
      (key) => update[key] !== before[key],
    );
    if (changed.length > 0) {
      await db.batch([
        db
          .update(schema.instances)
          .set({ ...update, updatedAt: new Date() })
          .where(eq(schema.instances.id, id)),
        db.insert(schema.auditLog).values({
          adminId: c.var.admin.id,
          action: "instance.updated",
          target: id,
          details: { changed },
        }),
      ]);
    }
    return c.json(await readWritten(c, id), 200);
  });

  app.openapi(updateInstanceAppearanceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const colors = upperColors(c.req.valid("json").colors);
    const { db } = c.var.platform;
    const [before] = await db.select().from(schema.instances).where(eq(schema.instances.id, id));
    if (!before) return notFound(c);

    if (JSON.stringify(colors) !== JSON.stringify(upperColors(before.colors))) {
      await db.batch([
        db
          .update(schema.instances)
          .set({ colors, updatedAt: new Date() })
          .where(eq(schema.instances.id, id)),
        db.insert(schema.auditLog).values({
          adminId: c.var.admin.id,
          action: "instance.colors_changed",
          target: id,
          details: { from: before.colors, to: colors },
        }),
      ]);
    }
    return c.json(await readWritten(c, id), 200);
  });

  app.openapi(uploadInstanceImageRoute, async (c) => {
    const { id, kind } = c.req.valid("param");
    const { db } = c.var.platform;
    if (!(await instanceExists(db, id))) return notFound(c);

    const image = await storeUploadedImage(
      c,
      kind === "background" ? MAX_BACKGROUND_BYTES : MAX_IMAGE_BYTES,
    );
    if (image instanceof Response) return image;

    await db.batch([
      upsertImageBlob(db, image),
      db
        .update(schema.instances)
        .set({
          [kind === "icon" ? "iconBlob" : "backgroundBlob"]: image.sha256,
          updatedAt: new Date(),
        })
        .where(eq(schema.instances.id, id)),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: `instance.${kind}_changed`,
        target: id,
        details: { sha256: image.sha256 },
      }),
    ]);
    return c.json(await readWritten(c, id), 200);
  });

  app.openapi(deleteInstanceImageRoute, async (c) => {
    const { id, kind } = c.req.valid("param");
    const { db, blobs } = c.var.platform;
    if (!(await instanceExists(db, id))) return notFound(c);

    const audit = db.insert(schema.auditLog).values({
      adminId: c.var.admin.id,
      action: kind === "icon" ? "instance.icon_removed" : "instance.background_reset",
      target: id,
    });
    if (kind === "icon") {
      await db.batch([
        db
          .update(schema.instances)
          .set({ iconBlob: null, updatedAt: new Date() })
          .where(eq(schema.instances.id, id)),
        audit,
      ]);
    } else {
      const background = await ensureDefaultBackground(blobs);
      await db.batch([
        upsertImageBlob(db, background),
        db
          .update(schema.instances)
          .set({ backgroundBlob: background.sha256, updatedAt: new Date() })
          .where(eq(schema.instances.id, id)),
        audit,
      ]);
    }
    return c.json(await readWritten(c, id), 200);
  });

  app.openapi(deleteInstanceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { db } = c.var.platform;
    const [instance] = await db
      .select({ name: schema.instances.name })
      .from(schema.instances)
      .where(eq(schema.instances.id, id));
    if (!instance) return notFound(c);

    // Children are deleted explicitly: libSQL doesn't enforce foreign keys (and their cascades).
    await db.batch([
      db.delete(schema.instanceFiles).where(eq(schema.instanceFiles.instanceId, id)),
      db.delete(schema.instanceManagedDirs).where(eq(schema.instanceManagedDirs.instanceId, id)),
      db.delete(schema.instanceWhitelist).where(eq(schema.instanceWhitelist.instanceId, id)),
      db.delete(schema.instanceBlacklist).where(eq(schema.instanceBlacklist.instanceId, id)),
      db.delete(schema.instances).where(eq(schema.instances.id, id)),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: "instance.deleted",
        target: id,
        details: { name: instance.name },
      }),
    ]);
    return c.body(null, 204);
  });
}
