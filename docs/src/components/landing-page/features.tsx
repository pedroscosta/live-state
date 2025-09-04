import { cn } from "@/lib/utils";
import { CloudOff, DatabaseZap, Flame, Package } from "lucide-react";

export function Features() {
  const features = [
    {
      title: "Offline-first",
      description: "Save changes locally and sync when you're back online.",
      icon: <CloudOff />,
    },
    {
      title: "Fine-grained reactivity",
      description: "React only when the query result changes.",
      icon: <Flame />,
    },
    {
      title: "Built-in ORM",
      description: "Built-in ORM to model and interact with your database.",
      icon: <Package />,
    },
    {
      title: "Works with any database",
      description: "live-state works with any database, be it NoSQL or SQL.",
      icon: <DatabaseZap />,
    },
    // TODO: Add more features -- Tree shakable, type safe, + 2 more features
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 text-left relative z-10 max-w-7xl mx-auto border-t">
      {features.map((feature, index) => (
        <Feature key={feature.title} {...feature} index={index} />
      ))}
    </div>
  );
}

const Feature = ({
  title,
  description,
  icon,
  index,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  index: number;
}) => {
  return (
    <div
      className={cn(
        "flex flex-col md:border-r md:border-b py-10 relative group/feature",
        index % 2 === 0 && "md:border-l lg:border-l-0",
        index % 4 === 0 && "lg:border-l",
        index < 4 && "lg:border-b"
      )}
    >
      {index < 4 && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-t from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      {index >= 4 && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-b from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      <div className="mb-4 relative z-10 px-10 text-neutral-600 dark:text-neutral-400">
        {icon}
      </div>
      <div className="text-lg font-bold mb-2 relative z-10 px-10">
        <div className="absolute left-0 inset-y-0 h-6 group-hover/feature:h-8 w-1 rounded-tr-full rounded-br-full bg-neutral-300 dark:bg-neutral-700 group-hover/feature:bg-blue-500 transition-all duration-200 origin-center" />
        <span className="group-hover/feature:translate-x-2 transition duration-200 inline-block text-neutral-800 dark:text-neutral-100">
          {title}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300 max-w-xs relative z-10 px-10">
        {description}
      </p>
    </div>
  );
};
