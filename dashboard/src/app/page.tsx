import { ScheduleNavigator3D } from "@/components/schedule-navigator-3d/ScheduleNavigator3D";
import { ProjectIndex } from "@/components/ProjectIndex";

/**
 * `/` with no `?project=` is the starting page — the index of the three
 * project phases. `/?project=<id>` renders the navigator for that project,
 * so every existing deep link keeps working unchanged.
 *
 * Server component on purpose: branching on searchParams here avoids the
 * client-side flash of one view before the other takes over.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const raw = params.project;
  const project = Array.isArray(raw) ? raw[0] : raw;

  if (!project) return <ProjectIndex />;
  return <ScheduleNavigator3D />;
}
