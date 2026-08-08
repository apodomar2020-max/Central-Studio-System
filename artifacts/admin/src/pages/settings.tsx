/**
 * Admin → Settings
 *
 * Domain Tabs:
 *   1. Class Pricing — manage single-session price for regular classes.
 *   2. Class Capacity — toggle capacity enforcement and display.
 *   3. Class Reminders — configure automated class reminder categories & view worker health status.
 *   4. Background Music — manage remote Mobile app background soundtrack & preview audio.
 *   5. Dance Types — manage canonical list of dance categories and SVG icons.
 */

import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, parseSettingsTab, buildSettingsTabUrl, type SettingsTab } from "./settings/tabState";
import { ClassPricingTab } from "./settings/ClassPricingTab";
import { ClassCapacityTab } from "./settings/ClassCapacityTab";
import { ClassRemindersTab } from "./settings/ClassRemindersTab";
import { BackgroundMusicTab } from "./settings/BackgroundMusicTab";
import { DanceTypesTab } from "./settings/DanceTypesTab";

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const activeTab: SettingsTab = parseSettingsTab(search);

  const handleTabChange = (newTabValue: string) => {
    const url = buildSettingsTabUrl(newTabValue as SettingsTab);
    setLocation(url);
  };

  return (
    <div className="space-y-6">
      {/* Main Settings Header — Clean, no global header action */}
      <PageHeader
        title="Settings"
        description="Manage studio-wide configuration"
        mode="studio"
      />

      {/* Top-Level Horizontal Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex h-11 items-center justify-start rounded-lg bg-muted/60 p-1 text-muted-foreground border border-border/40">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-[#00B6D7] data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-[#00B6D7]/30"
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Tab Panels */}
        <TabsContent value="pricing" className="focus-visible:outline-none">
          <ClassPricingTab />
        </TabsContent>

        <TabsContent value="capacity" className="focus-visible:outline-none">
          <ClassCapacityTab />
        </TabsContent>

        <TabsContent value="reminders" className="focus-visible:outline-none">
          <ClassRemindersTab />
        </TabsContent>

        <TabsContent value="music" className="focus-visible:outline-none">
          <BackgroundMusicTab />
        </TabsContent>

        <TabsContent value="dance-types" className="focus-visible:outline-none">
          <DanceTypesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
