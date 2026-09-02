import React from 'react';
import { FileText } from 'lucide-react';
import BlogShell from './blog/BlogShell';

export const TermsOfServiceContent: React.FC = () => (
            <article aria-labelledby="terms-title">
                <header className="mb-10">
                    <p className="nx-public-badge mb-5 gap-2">
                        <FileText aria-hidden="true" size={17} />
                        Condiciones del servicio
                    </p>
                    <h1 id="terms-title" className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl">
                        Términos de Servicio
                    </h1>
                    <p className="nx-public-subtle mt-4 text-sm">Última actualización: 12 de febrero de 2026</p>
                </header>

                <div className="nx-public-reading space-y-9">
                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">1. Aceptación de los Términos</h2>
                        <p>Al registrarse, acceder o utilizar la plataforma NORTEX ("el Servicio"), operada por NORTEX INC. ("nosotros", "la Empresa"), usted ("el Usuario", "el Cliente") acepta estar vinculado por estos Términos de Servicio. Si no está de acuerdo con alguna parte de estos términos, no debe usar el Servicio.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">2. Descripción del Servicio</h2>
                        <p>NORTEX es una plataforma SaaS (Software como Servicio) de gestión financiera y operativa diseñada para pequeñas y medianas empresas en Latinoamérica. El Servicio incluye, pero no se limita a:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Punto de Venta (POS) con soporte para lectores de código de barras</li>
                            <li>Gestión de inventario con sistema Kardex</li>
                            <li>Facturación y cuentas por cobrar</li>
                            <li>Gestión de recursos humanos y nómina</li>
                            <li>Reportes financieros y fiscales</li>
                            <li>Cotizaciones y gestión de clientes</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">3. Registro y Cuentas</h2>
                        <p>Para utilizar el Servicio, usted debe:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Proporcionar información veraz, precisa y completa durante el registro.</li>
                            <li>Mantener la seguridad de su contraseña y credenciales de acceso.</li>
                            <li>Notificar inmediatamente cualquier uso no autorizado de su cuenta.</li>
                            <li>Ser mayor de 18 años o tener la capacidad legal para celebrar contratos.</li>
                        </ul>
                        <p className="mt-2">Usted es responsable de todas las actividades que ocurran bajo su cuenta.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">4. Planes y Pagos</h2>
                        <p>El Servicio se ofrece mediante suscripción mensual. Los términos de pago son:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>El costo de la suscripción se factura mensualmente por adelantado.</li>
                            <li>Los pagos se procesan a través de Stripe o mediante depósito/transferencia bancaria.</li>
                            <li>En caso de impago, el acceso a funciones de escritura (ventas, inventario) será suspendido. El acceso de lectura (reportes, consultas) se mantiene.</li>
                            <li>No se realizan reembolsos por períodos parciales de uso.</li>
                            <li>Nos reservamos el derecho de modificar los precios con 30 días de aviso previo.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">5. Uso Aceptable</h2>
                        <p>El Usuario se compromete a no:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Usar el Servicio para actividades ilegales o fraudulentas.</li>
                            <li>Intentar acceder a cuentas o datos de otros usuarios.</li>
                            <li>Realizar ingeniería inversa, descifrar o descompilar el software.</li>
                            <li>Cargar contenido malicioso, virus o código dañino.</li>
                            <li>Sobrecargar intencionalmente los servidores o infraestructura.</li>
                            <li>Revender el acceso al Servicio sin autorización escrita.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">6. Propiedad de los Datos</h2>
                        <p>Usted mantiene la propiedad total de todos los datos que ingresa al Servicio, incluyendo información de clientes, productos, ventas, empleados y registros financieros. NORTEX no reclama propiedad sobre sus datos comerciales.</p>
                        <p className="mt-2">Usted nos otorga una licencia limitada para procesar, almacenar y mostrar sus datos únicamente con el propósito de proveer el Servicio.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">7. Disponibilidad del Servicio</h2>
                        <p>Nos esforzamos por mantener una disponibilidad del 99.5%. Sin embargo, no garantizamos un servicio ininterrumpido. Se podrán realizar mantenimientos programados con aviso previo de al menos 24 horas. No seremos responsables por interrupciones causadas por terceros, fuerza mayor o eventos fuera de nuestro control.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">8. Limitación de Responsabilidad</h2>
                        <p>NORTEX no será responsable por:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Pérdidas derivadas de decisiones comerciales basadas en los reportes del sistema.</li>
                            <li>Daños indirectos, incidentales o consecuentes.</li>
                            <li>Pérdida de datos causada por negligencia del usuario.</li>
                            <li>Interrupciones de servicio por causas de fuerza mayor.</li>
                        </ul>
                        <p className="mt-2">Nuestra responsabilidad total acumulada no excederá el monto pagado por el usuario en los últimos 3 meses de servicio.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">9. Cancelación</h2>
                        <p>El Usuario puede cancelar su suscripción en cualquier momento desde la sección de Facturación. Al cancelar:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>El acceso se mantiene hasta el final del período pagado.</li>
                            <li>Los datos del usuario se conservan por 30 días después de la cancelación.</li>
                            <li>Después de 30 días, los datos podrán ser eliminados permanentemente.</li>
                            <li>El usuario puede solicitar una exportación de sus datos antes de la eliminación.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">10. Modificaciones</h2>
                        <p>Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios significativos serán notificados con al menos 15 días de anticipación mediante la plataforma o correo electrónico. El uso continuado del Servicio después de la notificación constituye aceptación de los nuevos términos.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">11. Ley Aplicable</h2>
                        <p>Estos Términos se rigen por las leyes de la República de Nicaragua. Cualquier disputa se resolverá mediante arbitraje en la ciudad de Managua, conforme a las reglas del Centro de Mediación y Arbitraje de la Cámara de Comercio de Nicaragua.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">12. Contacto</h2>
                        <p>Para consultas sobre estos Términos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Email: <span className="nx-prose-strong">legal@somosnortex.com</span></li>
                            <li>Web: <span className="nx-prose-strong">https://somosnortex.com</span></li>
                        </ul>
                    </section>
                </div>
            </article>
);

const TermsOfService: React.FC = () => {
    return (
        <BlogShell
            width="reading"
            eyebrow="Legal"
            contentId="terms-main-content"
            actions={[]}
            footerLinks={[{ to: '/', label: 'Volver al inicio' }]}
        >
            <TermsOfServiceContent />
        </BlogShell>
    );
};

export default TermsOfService;
