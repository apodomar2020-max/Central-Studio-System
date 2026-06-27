import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListHeroItems,
  useCreateHeroItem,
  useUpdateHeroItem,
  useDeleteHeroItem,
  getListHeroItemsQueryKey,
} from "@workspace/api-client-react";
import type { HeroItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit, GripVertical, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

// Task 1.1: Hero is an image carousel only. The CMS collects just the image URL
// and an optional tap path (where the app navigates when the slide is pressed).
// Legacy content columns (title/tagline/buttonText) were removed from the entire
// stack (DB migration 0026_hero_image_only) — no placeholders, no dead fields.
const formSchema = z.object({
  imageUrl: z.string().min(1, "Image URL is required"),
  buttonRoute: z.string().default(""),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;

export default function HeroItems() {
  const { can } = useAdminAuth();
  const canCreate = can("heroSlides", "create");
  const canEdit = can("heroSlides", "edit");
  const canDelete = can("heroSlides", "delete");
  const { data: items, isLoading } = useListHeroItems();
  const createItem = useCreateHeroItem();
  const updateItem = useUpdateHeroItem();
  const deleteItem = useDeleteHeroItem();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HeroItem | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      imageUrl: "", buttonRoute: "",
      sortOrder: 0, isActive: true,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      imageUrl: "", buttonRoute: "",
      sortOrder: (items?.length ?? 0) * 10, isActive: true,
    });
    setOpen(true);
  };

  const openEdit = (item: HeroItem) => {
    setEditing(item);
    form.reset({
      imageUrl: item.imageUrl,
      buttonRoute: item.buttonRoute,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
    });
    setOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListHeroItemsQueryKey() });
    setOpen(false);
  };

  const onSubmit = (values: FormValues) => {
    // Hero is image-only: image URL + tap route + ordering + active flag.
    const data = {
      imageUrl: values.imageUrl,
      buttonRoute: values.buttonRoute || "",
      sortOrder: values.sortOrder,
      isActive: values.isActive,
    };
    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to save: ${msg}`);
    };
    if (editing) {
      updateItem.mutate({ id: editing.id, data }, { onSuccess: invalidate, onError });
    } else {
      createItem.mutate({ data }, { onSuccess: invalidate, onError });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this hero slide?")) {
      deleteItem.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListHeroItemsQueryKey() }) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hero Slides"
        description="Manage the home screen carousel"
        mode="studio"
        addLabel="Add Slide"
        addTestId="button-add-hero-item"
        onAdd={canCreate ? openCreate : undefined}
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">Order</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>Tap Path</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : items?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No hero slides yet. Add one to replace the static banner on the mobile home screen.
                </TableCell>
              </TableRow>
            ) : (
              items?.map((item) => (
                <TableRow key={item.id} data-testid={`row-hero-item-${item.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <GripVertical className="h-4 w-4" />
                      <span className="text-xs">{item.sortOrder}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="relative h-14 w-24 rounded overflow-hidden bg-muted flex-shrink-0">
                      <img
                        src={item.imageUrl}
                        alt={`Hero slide ${item.id}`}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {item.buttonRoute ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <ExternalLink className="h-3 w-3" />
                        <span className="truncate">{item.buttonRoute}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">— (no link)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "default" : "outline"}>
                      {item.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-edit-hero-item-${item.id}`}
                        onClick={() => openEdit(item)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-delete-hero-item-${item.id}`}
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Slide" : "Add Hero Slide"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="imageUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Image URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://images.unsplash.com/..."
                      data-testid="input-hero-image-url"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {form.watch("imageUrl") && (
                <div className="relative h-32 w-full rounded overflow-hidden bg-muted">
                  <img
                    src={form.watch("imageUrl")}
                    alt="Preview"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}

              <FormField control={form.control} name="buttonRoute" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tap Path (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="/(tabs)/classes — where the app goes when the slide is tapped"
                      data-testid="input-hero-button-route"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="sortOrder" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort Order (lower = first)</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} data-testid="input-hero-sort-order" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="!mt-0">Active (visible in app)</FormLabel>
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  type="submit"
                  data-testid="button-submit-hero-item"
                  disabled={createItem.isPending || updateItem.isPending}
                >
                  {editing ? "Save Changes" : "Add Slide"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
