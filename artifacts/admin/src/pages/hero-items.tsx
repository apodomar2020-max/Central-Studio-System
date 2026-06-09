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

const formSchema = z.object({
  imageUrl: z.string().min(1, "Image URL is required"),
  tagline: z.string().nullish(),
  title: z.string().min(1, "Title is required"),
  buttonText: z.string().default("Get Started"),
  buttonRoute: z.string().default("/(tabs)/classes"),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;

export default function HeroItems() {
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
      imageUrl: "", tagline: "", title: "",
      buttonText: "Get Started", buttonRoute: "/(tabs)/classes",
      sortOrder: 0, isActive: true,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      imageUrl: "", tagline: "", title: "",
      buttonText: "Get Started", buttonRoute: "/(tabs)/classes",
      sortOrder: (items?.length ?? 0) * 10, isActive: true,
    });
    setOpen(true);
  };

  const openEdit = (item: HeroItem) => {
    setEditing(item);
    form.reset({
      imageUrl: item.imageUrl,
      tagline: item.tagline ?? "",
      title: item.title,
      buttonText: item.buttonText,
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
    const data = {
      ...values,
      tagline: values.tagline || null,
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
        onAdd={openCreate}
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">Order</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Tagline</TableHead>
              <TableHead>Button</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : items?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                        alt={item.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium max-w-[160px] truncate">{item.title}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[140px] truncate">
                    {item.tagline ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <span>{item.buttonText}</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground">{item.buttonRoute}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "default" : "outline"}>
                      {item.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost" size="icon"
                      data-testid={`button-edit-hero-item-${item.id}`}
                      onClick={() => openEdit(item)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      data-testid={`button-delete-hero-item-${item.id}`}
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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

              <FormField control={form.control} name="tagline" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tagline (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Egypt's Top Dance School"
                      data-testid="input-hero-tagline"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Explore The Art Of Movement"
                      data-testid="input-hero-title"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="buttonText" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Button Text</FormLabel>
                    <FormControl>
                      <Input data-testid="input-hero-button-text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="buttonRoute" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Button Route</FormLabel>
                    <FormControl>
                      <Input placeholder="/(tabs)/classes" data-testid="input-hero-button-route" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

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
