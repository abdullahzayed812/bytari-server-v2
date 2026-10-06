import type { Knex } from 'knex';

/**
 * Store category hierarchy defaults — Pet Owners Store + Veterinarian Store.
 *
 * `parent_id` (migration 20261029010000) already models «main animal category
 * → product section». This one-off data migration gives a store that has not
 * been organised yet the default tree:
 *
 *   «الحيوانات الأليفة» / «الأغنام والماعز» / «الأبقار» / «الدواجن»
 *     └─ «أدوية» · «أغذية وأعلاف» · «مكملات غذائية» · «إكسسوارات ومستلزمات»
 *
 * A store that already has any sub-category is left untouched (an admin has
 * built their own tree). Slugs are inserted ON CONFLICT DO NOTHING, existing
 * flat categories and their products are never moved. A migration (not a
 * seed) so it runs exactly once and an admin deleting a default stays deleted.
 */
const STORES = ['pet_owner_store', 'veterinarian_store'] as const;

const ANIMALS = [
  { slug: 'pets', name: 'الحيوانات الأليفة' },
  { slug: 'sheep', name: 'الأغنام والماعز' },
  { slug: 'cattle', name: 'الأبقار' },
  { slug: 'poultry', name: 'الدواجن' },
] as const;

const SECTIONS = [
  { slug: 'medicines', name: 'أدوية' },
  { slug: 'food', name: 'أغذية وأعلاف' },
  { slug: 'supplements', name: 'مكملات غذائية' },
  { slug: 'accessories', name: 'إكسسوارات ومستلزمات' },
] as const;

const childSlug = (animal: string, section: string): string => `${animal}-${section}`;

export async function up(knex: Knex): Promise<void> {
  for (const s of STORES) {
    const table = `${s}_categories`;
    const organised = await knex(table).whereNotNull('parent_id').first('id');
    if (organised) continue;

    for (const [i, animal] of ANIMALS.entries()) {
      await knex(table)
        .insert({
          slug: animal.slug,
          name: animal.name,
          show_on_home: true,
          sort_order: i,
          status: 'ACTIVE',
        })
        .onConflict('slug')
        .ignore();
      const parent: { id: string; parent_id: string | null } | undefined = await knex(table)
        .where({ slug: animal.slug })
        .first('id', 'parent_id');
      // A pre-existing sub-category already using the slug cannot be a section.
      if (!parent || parent.parent_id !== null) continue;

      for (const [j, section] of SECTIONS.entries()) {
        await knex(table)
          .insert({
            slug: childSlug(animal.slug, section.slug),
            name: section.name,
            parent_id: parent.id,
            show_on_home: false,
            sort_order: j,
            status: 'ACTIVE',
          })
          .onConflict('slug')
          .ignore();
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove only defaults no product references (never destroys admin data).
  for (const s of STORES) {
    const table = `${s}_categories`;
    const children = ANIMALS.flatMap((a) => SECTIONS.map((x) => childSlug(a.slug, x.slug)));
    await knex(table)
      .whereIn('slug', children)
      .whereNotExists(knex(`${s}_products`).whereRaw(`category_id = ${table}.id`))
      .delete();
    await knex(table)
      .whereIn(
        'slug',
        ANIMALS.map((a) => a.slug),
      )
      .whereNotExists(knex(`${s}_products`).whereRaw(`category_id = ${table}.id`))
      .whereNotExists(knex(`${table} as c2`).whereRaw(`c2.parent_id = ${table}.id`))
      .delete();
  }
}
