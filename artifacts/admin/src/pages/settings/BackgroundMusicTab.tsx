import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, Music2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  API,
  adminFetch,
  backgroundMusicSchema,
  type BackgroundMusicSettings,
  type BackgroundMusicForm,
  type BackgroundMusicTestResult,
} from "./types";

export function BackgroundMusicTab() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Audio lifecycle cleanup: ensure audio stops when leaving the tab / unmounting
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setIsPreviewPlaying(false);
    };
  }, []);

  const { data: backgroundMusic, isLoading: isLoadingBackgroundMusic } = useQuery<BackgroundMusicSettings>({
    queryKey: ["admin-background-music"],
    queryFn: () =>
      adminFetch<BackgroundMusicSettings>(
        `${API}/api/admin/settings/background-music`,
        { method: "GET" },
        token,
      ),
  });

  const invalidateBackgroundMusic = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-background-music"] });

  const backgroundMusicForm = useForm<BackgroundMusicForm>({
    resolver: zodResolver(backgroundMusicSchema),
    values: {
      enabled: backgroundMusic?.enabled ?? false,
      sourceUrl: backgroundMusic?.sourceUrl ?? "",
      sourceTitle: backgroundMusic?.sourceTitle ?? "",
      volume: backgroundMusic?.volume ?? 0.25,
      loop: backgroundMusic?.loop ?? true,
    },
  });

  const testBackgroundMusicMutation = useMutation({
    mutationFn: (data: Pick<BackgroundMusicForm, "sourceUrl" | "sourceTitle">) =>
      adminFetch<BackgroundMusicTestResult>(
        `${API}/api/admin/settings/background-music/test`,
        { method: "POST", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: (result) => {
      setPreviewUrl(result.sourceUrl);
      toast({ title: "Music URL validated", description: result.contentType ?? result.sourceType });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Music URL rejected", description: e?.data?.error ?? "Could not validate this URL", variant: "destructive" }),
  });

  const updateBackgroundMusicMutation = useMutation({
    mutationFn: (data: BackgroundMusicForm) =>
      adminFetch<BackgroundMusicSettings>(
        `${API}/api/admin/settings/background-music`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: data.enabled,
            sourceUrl: data.sourceUrl?.trim() || undefined,
            sourceTitle: data.sourceTitle?.trim() || null,
            volume: data.volume,
            loop: data.loop,
          }),
        },
        token,
      ),
    onSuccess: (settings) => {
      invalidateBackgroundMusic();
      setPreviewUrl(settings.sourceUrl);
      toast({ title: "Background music updated", description: `Revision ${settings.version}` });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save background music", variant: "destructive" }),
  });

  const onBackgroundMusicSubmit = (values: BackgroundMusicForm) => {
    updateBackgroundMusicMutation.mutate(values);
  };

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setIsPreviewPlaying(false);
  };

  const testPreview = async () => {
    const values = backgroundMusicForm.getValues();
    if (!values.sourceUrl?.trim()) {
      toast({ title: "Music URL required", description: "Add a public HTTPS audio URL first.", variant: "destructive" });
      return;
    }
    stopPreview();
    const result = await testBackgroundMusicMutation.mutateAsync({
      sourceUrl: values.sourceUrl,
      sourceTitle: values.sourceTitle,
    }).catch(() => null);
    if (!result) return;
    const audio = new Audio(result.sourceUrl);
    audio.volume = Math.max(0, Math.min(1, Number(values.volume ?? 0.25)));
    audio.loop = Boolean(values.loop);
    audio.addEventListener("ended", () => setIsPreviewPlaying(false), { once: true });
    previewAudioRef.current = audio;
    try {
      await audio.play();
      setIsPreviewPlaying(true);
    } catch {
      setIsPreviewPlaying(false);
      toast({ title: "Preview blocked", description: "The browser could not start playback. Try again after interacting with the page.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Background Music</h2>
        <p className="text-sm text-muted-foreground">
          Remotely manage the low-volume soundtrack used by the Central Studio mobile app.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Form {...backgroundMusicForm}>
          <form onSubmit={backgroundMusicForm.handleSubmit(onBackgroundMusicSubmit)} className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <FormField
                control={backgroundMusicForm.control}
                name="sourceUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public HTTPS Audio URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://drive.google.com/file/d/..."
                        disabled={isLoadingBackgroundMusic || !canEdit}
                        data-testid="input-background-music-url"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={backgroundMusicForm.control}
                name="sourceTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Optional"
                        disabled={isLoadingBackgroundMusic || !canEdit}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <FormField
                control={backgroundMusicForm.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3 bg-background/50">
                    <div>
                      <FormLabel className="!mt-0">Enabled</FormLabel>
                      <p className="text-xs text-muted-foreground">Global mobile playback</p>
                    </div>
                    <FormControl>
                      <Switch disabled={!canEdit} checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={backgroundMusicForm.control}
                name="loop"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3 bg-background/50">
                    <div>
                      <FormLabel className="!mt-0">Loop</FormLabel>
                      <p className="text-xs text-muted-foreground">Repeat continuously</p>
                    </div>
                    <FormControl>
                      <Switch disabled={!canEdit} checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="rounded-md border p-3 bg-background/50">
                <div className="flex items-center justify-between">
                  <Label>Revision</Label>
                  <Badge variant="outline">{backgroundMusic?.version ?? 1}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {backgroundMusic?.updatedAt ? new Date(backgroundMusic.updatedAt).toLocaleString() : "Not saved yet"}
                </p>
              </div>
            </div>

            <FormField
              control={backgroundMusicForm.control}
              name="volume"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Volume</FormLabel>
                    <span className="text-sm text-muted-foreground">{Math.round(Number(field.value ?? 0.25) * 100)}%</span>
                  </div>
                  <FormControl>
                    <Slider
                      value={[Number(field.value ?? 0.25)]}
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={!canEdit}
                      onValueChange={(value) => field.onChange(value[0] ?? 0.25)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {canEdit && (
                <Button
                  type="submit"
                  data-testid="button-save-background-music"
                  disabled={isLoadingBackgroundMusic || updateBackgroundMusicMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Music
                </Button>
              )}
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void testPreview(); }}
                  disabled={testBackgroundMusicMutation.isPending}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Test Preview
                </Button>
              )}
              {isPreviewPlaying && (
                <Button type="button" variant="secondary" onClick={stopPreview}>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Preview
                </Button>
              )}
              {previewUrl && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Music2 className="h-3.5 w-3.5" />
                  Preview uses the normalized mobile URL
                </span>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
