"use client";

import { useParams } from "next/navigation";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { BlogEditor } from "../_components/BlogEditor";

export default function BlogEditClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, isLoading, error } = api.blog.get.useQuery(
    { id: id ?? "" },
    { enabled: !!id, retry: false },
  );

  if (!id) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Missing post id.</p>
      </Shell>
    );
  }
  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Loading…</p>
      </Shell>
    );
  }
  if (error || !data) {
    return (
      <Shell>
        <p className="text-sm text-red-500">Post not found.</p>
      </Shell>
    );
  }

  return <BlogEditor initialPost={data} postId={id} />;
}
