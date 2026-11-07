import { Routes } from '@angular/router';
import { roleGuard } from './core/auth.service';
import { PublicLayout } from './public/public-layout';

const staff = { roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] };
const managers = { roles: ['ADMIN', 'MANAGER'] };

export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      { path: '', loadComponent: () => import('./public/home.page').then((m) => m.HomePage), title: 'NÉA STUDIO — Beauty salon in Marrakech' },
      { path: 'services', loadComponent: () => import('./public/services.page').then((m) => m.ServicesPage), title: 'Services — NÉA STUDIO' },
      { path: 'booking', loadComponent: () => import('./public/booking.page').then((m) => m.BookingPage), title: 'Book an appointment — NÉA STUDIO' },
      { path: 'booking/manage', loadComponent: () => import('./public/manage-booking.page').then((m) => m.ManageBookingPage), title: 'Manage my booking — NÉA STUDIO' },
      { path: 'about', loadComponent: () => import('./public/info.pages').then((m) => m.AboutPage), title: 'About — NÉA STUDIO' },
      { path: 'gallery', loadComponent: () => import('./public/info.pages').then((m) => m.GalleryPage), title: 'Gallery — NÉA STUDIO' },
      { path: 'contact', loadComponent: () => import('./public/info.pages').then((m) => m.ContactPage), title: 'Contact — NÉA STUDIO' },
      { path: 'login', loadComponent: () => import('./public/auth.pages').then((m) => m.LoginPage), title: 'Sign in — NÉA STUDIO' },
      { path: 'account/create', loadComponent: () => import('./public/auth.pages').then((m) => m.ClaimPage), title: 'Create my account — NÉA STUDIO' },
      { path: 'account', canActivate: [roleGuard], data: { roles: ['CUSTOMER'] }, loadComponent: () => import('./account/account.page').then((m) => m.AccountPage), title: 'My account — NÉA STUDIO' },
    ],
  },
  {
    path: '',
    canActivate: [roleGuard],
    data: staff,
    loadComponent: () => import('./admin/console-layout').then((m) => m.ConsoleLayout),
    children: [
      { path: 'staff', loadComponent: () => import('./staff/staff-day.page').then((m) => m.StaffDayPage), title: 'My day — NÉA STUDIO' },
      { path: 'staff/scan', loadComponent: () => import('./staff/scan.page').then((m) => m.ScanPage), title: 'Scan — NÉA STUDIO' },
      {
        path: 'admin',
        canActivate: [roleGuard],
        data: managers,
        children: [
          { path: '', loadComponent: () => import('./admin/overview.page').then((m) => m.OverviewPage), title: 'Overview — NÉA STUDIO' },
          { path: 'availability', loadComponent: () => import('./admin/availability.page').then((m) => m.AvailabilityPage), title: 'Availability — NÉA STUDIO' },
          { path: 'appointments', loadComponent: () => import('./admin/appointments.page').then((m) => m.AppointmentsPage), title: 'Appointments — NÉA STUDIO' },
          { path: 'customers', loadComponent: () => import('./admin/customers.page').then((m) => m.CustomersPage), title: 'Customers — NÉA STUDIO' },
          { path: 'customers/:id', loadComponent: () => import('./admin/customers.page').then((m) => m.CustomerDetailPage), title: 'Customer — NÉA STUDIO' },
          { path: 'employees', loadComponent: () => import('./admin/employees.page').then((m) => m.EmployeesPage), title: 'Team — NÉA STUDIO' },
          { path: 'employees/:id', loadComponent: () => import('./admin/employees.page').then((m) => m.EmployeeDetailPage), title: 'Team member — NÉA STUDIO' },
          { path: 'services', loadComponent: () => import('./admin/services.page').then((m) => m.ServicesAdminPage), title: 'Services — NÉA STUDIO' },
          { path: 'loyalty', loadComponent: () => import('./admin/loyalty.page').then((m) => m.LoyaltyAdminPage), title: 'Loyalty — NÉA STUDIO' },
          { path: 'notifications', loadComponent: () => import('./admin/system.pages').then((m) => m.NotificationsPage), title: 'Notifications — NÉA STUDIO' },
          { path: 'settings', loadComponent: () => import('./admin/system.pages').then((m) => m.SettingsPage), title: 'Settings — NÉA STUDIO' },
          { path: 'audit', loadComponent: () => import('./admin/system.pages').then((m) => m.AuditPage), title: 'Audit log — NÉA STUDIO' },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
