'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PlannerDataV4 } from '@/lib/types';
import {
  getPlannerData,
  initialSyncPlannerFromFirestore,
  subscribePlanner,
  subscribePlannerLocal,
} from '@/lib/planner-storage';

type PlannerSyncContextValue = {
  data: PlannerDataV4;
  isSynced: boolean;
  hasCloud: boolean;
};

const emptySlotCounts = { '0': 2, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2 } as const;

const PlannerSyncContext = createContext<PlannerSyncContextValue>({
  data: {
    version: 4,
    updatedAt: 0,
    menus: [],
    basket: [],
    slotCountsByDay: { ...emptySlotCounts },
    otherShopping: [],
    todos: [],
  },
  isSynced: false,
  hasCloud: false,
});

export function usePlannerSync() {
  return useContext(PlannerSyncContext);
}

export function PlannerSyncProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<PlannerDataV4>(() => getPlannerData());
  const [isSynced, setSynced] = useState(false);
  const [hasCloud, setHasCloud] = useState(false);

  useEffect(() => {
    const unsubLocal = subscribePlannerLocal((next) => setData(next));
    let unsubCloud: (() => void) | null = null;

    initialSyncPlannerFromFirestore()
      .then(() => setSynced(true))
      .catch(() => setSynced(true))
      .finally(() => {
        setData(getPlannerData());
        unsubCloud = subscribePlanner((next) => {
          setHasCloud(true);
          setData(next);
        });
      });

    return () => {
      unsubLocal();
      if (unsubCloud) unsubCloud();
    };
  }, []);

  const value = useMemo(() => ({ data, isSynced, hasCloud }), [data, isSynced, hasCloud]);

  return <PlannerSyncContext.Provider value={value}>{children}</PlannerSyncContext.Provider>;
}

