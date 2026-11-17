import { redirect } from "next/navigation";

/** The fields now live on the products' structure page; older links keep working. */
export default async function ProductFieldsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/b/${slug}/products/structure#fields`);
}
