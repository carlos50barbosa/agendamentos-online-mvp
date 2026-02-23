import React from 'react';

function SkeletonBar({ className = '' }) {
  return <div className={`tw-animate-pulse tw-rounded-md tw-bg-slate-200 ${className}`} />;
}

export default function SkeletonList({ count = 6 }) {
  const items = Array.from({ length: count });

  return (
    <div className="tw-space-y-4">
      <div className="tw-hidden tw-overflow-hidden tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-shadow-sm md:tw-block">
        <div className="tw-grid tw-grid-cols-[2.2fr_1.3fr_1fr_1.3fr] tw-gap-4 tw-border-b tw-border-slate-100 tw-bg-slate-50 tw-p-4">
          <SkeletonBar className="tw-h-3.5 tw-w-24" />
          <SkeletonBar className="tw-h-3.5 tw-w-20" />
          <SkeletonBar className="tw-h-3.5 tw-w-16" />
          <SkeletonBar className="tw-h-3.5 tw-w-20" />
        </div>
        {items.map((_, index) => (
          <div
            key={`table-skeleton-${index}`}
            className="tw-grid tw-grid-cols-[2.2fr_1.3fr_1fr_1.3fr] tw-items-center tw-gap-4 tw-border-b tw-border-slate-100 tw-p-4 last:tw-border-b-0"
          >
            <div className="tw-space-y-2">
              <SkeletonBar className="tw-h-4 tw-w-56" />
              <SkeletonBar className="tw-h-3 tw-w-40" />
            </div>
            <SkeletonBar className="tw-h-4 tw-w-32" />
            <SkeletonBar className="tw-h-6 tw-w-28 tw-rounded-full" />
            <div className="tw-flex tw-justify-end tw-gap-2">
              <SkeletonBar className="tw-h-8 tw-w-24" />
              <SkeletonBar className="tw-h-8 tw-w-24" />
            </div>
          </div>
        ))}
      </div>

      <div className="tw-space-y-3 md:tw-hidden">
        {items.map((_, index) => (
          <div
            key={`card-skeleton-${index}`}
            className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-4 tw-shadow-sm"
          >
            <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
              <SkeletonBar className="tw-h-4 tw-w-40" />
              <SkeletonBar className="tw-h-6 tw-w-24 tw-rounded-full" />
            </div>
            <SkeletonBar className="tw-mt-3 tw-h-3.5 tw-w-32" />
            <SkeletonBar className="tw-mt-3 tw-h-3.5 tw-w-36" />
            <div className="tw-mt-4 tw-grid tw-grid-cols-2 tw-gap-2">
              <SkeletonBar className="tw-h-9 tw-w-full" />
              <SkeletonBar className="tw-h-9 tw-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
