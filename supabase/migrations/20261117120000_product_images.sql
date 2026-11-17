-- Product photos uploaded from the product form. Public: the link is the product's image_url,
-- which the agent sends to customers and the catalog shows. Writes go only through the server
-- (service role) under the business's own folder; there are no client storage policies.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
