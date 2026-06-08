import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import instructorsRouter from "./instructors";
import classesRouter from "./classes";
import schedulesRouter from "./schedules";
import pricePackagesRouter from "./pricePackages";
import bookingsRouter from "./bookings";
import studentsRouter from "./students";
import offersRouter from "./offers";
import notificationsRouter from "./notifications";
import marketingRouter from "./marketing";
import analyticsRouter from "./analytics";
import packageOrdersRouter from "./packageOrders";
import attendanceRouter from "./attendance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(analyticsRouter);
router.use(instructorsRouter);
router.use(classesRouter);
router.use(schedulesRouter);
router.use(pricePackagesRouter);
router.use(bookingsRouter);
router.use(studentsRouter);
router.use(offersRouter);
router.use(notificationsRouter);
router.use(marketingRouter);
router.use(attendanceRouter);
router.use(packageOrdersRouter);

export default router;
